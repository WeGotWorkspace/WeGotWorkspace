<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\ChatReadMarker;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Chat\Conversion\ChatMessageJournalConverter;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use PDOException;
use Sabre\CalDAV\Backend\PDO as CalPDO;

/**
 * Chat messages as VJOURNAL objects in chat channel collections (Epic #701).
 *
 * Every mutation goes through the Sabre calendar backend so it surfaces in
 * `calendarchanges` — the changes feed is the sync contract, not an option.
 * Concurrency is semantic, not etag-based (no CRDT, no If-Match):
 * - create: append-only, client ULID => idempotent retry
 * - edit/delete: STRICTLY author-only => single writer, LWW by SEQUENCE
 * - reactions: (emoji, author) toggle, read-modify-write inside a DB
 *   transaction => concurrent toggles merge like an OR-set; SEQUENCE untouched
 *
 * Ordering source of truth is (created_ts, uid): the server-assigned DTSTAMP
 * with the ULID as tiebreak — the ULID alone is never the comparator.
 */
final class ChatMessageRepository
{
    public const DEFAULT_PAGE_SIZE = 50;

    public const MAX_PAGE_SIZE = 200;

    public const CHANGES_PAGE_SIZE = 200;

    public function __construct(
        private readonly ChatChannelRepository $channels,
        private readonly ChatMessageJournalConverter $converter,
        private readonly ChatChangesFeed $changesFeed,
        private readonly CalendarCollectionAccess $collectionAccess,
    ) {}

    /**
     * Cursor-paged window ordered by (created_ts, uid) ascending.
     * `since`/`before` are message ULID cursors (exclusive); without a cursor
     * the latest window is returned. hasMore reports messages beyond the
     * window in the direction being paged.
     *
     * @return array{list: list<array<string, mixed>>, hasMore: bool}
     */
    public function list(string $username, string $channelId, ?string $since, ?string $before, ?int $limit): array
    {
        $instance = $this->requireChannel($username, $channelId);
        if ($since !== null && $before !== null) {
            throw new ApiHttpException(400, 'Use either since or before, not both.', 'bad_request');
        }
        $pageSize = min(max($limit ?? self::DEFAULT_PAGE_SIZE, 1), self::MAX_PAGE_SIZE);

        $messages = $this->sortedChannelMessages($instance);

        if ($since !== null) {
            $position = $this->cursorPosition($messages, $since);
            $window = array_slice($messages, $position + 1, $pageSize);
            $hasMore = count($messages) - ($position + 1) > $pageSize;
        } elseif ($before !== null) {
            $position = $this->cursorPosition($messages, $before);
            $start = max(0, $position - $pageSize);
            $window = array_slice($messages, $start, $position - $start);
            $hasMore = $start > 0;
        } else {
            $window = array_slice($messages, -$pageSize);
            $hasMore = count($messages) > $pageSize;
        }

        return [
            'list' => $this->presentMessages($window, $messages, (string) $instance->uri),
            'hasMore' => $hasMore,
        ];
    }

    /**
     * Every message in one channel, presented — the JMAP ChatMessage/get
     * `ids: null` path (the bound check lives in the method handler).
     *
     * @return list<array<string, mixed>>
     */
    public function listAll(string $username, string $channelId): array
    {
        $instance = $this->requireChannel($username, $channelId);
        $messages = $this->sortedChannelMessages($instance);

        return $this->presentMessages($messages, $messages, (string) $instance->uri);
    }

    /**
     * Batch lookup by message id across accessible channels — the JMAP
     * ChatMessage/get explicit-ids path. Groups by channel so the reply-count
     * scan runs once per channel, not once per id.
     *
     * @param  list<string>  $ids
     * @return array{list: list<array<string, mixed>>, notFound: list<string>}
     */
    public function getByIds(string $username, array $ids): array
    {
        /** @var array<int, CalendarInstance> $instances */
        $instances = [];
        /** @var array<int, list<string>> $uidsByCalendar */
        $uidsByCalendar = [];
        $notFound = [];
        foreach ($ids as $id) {
            $located = $this->locateMessage($username, $id);
            if ($located === null) {
                $notFound[] = $id;

                continue;
            }
            [$object, $instance] = $located;
            $calendarId = (int) $instance->calendarid;
            $instances[$calendarId] = $instance;
            $uidsByCalendar[$calendarId][] = (string) $object->uid;
        }

        $list = [];
        foreach ($uidsByCalendar as $calendarId => $uids) {
            $instance = $instances[$calendarId];
            $all = $this->sortedChannelMessages($instance);
            $wanted = array_flip($uids);
            $window = array_values(array_filter(
                $all,
                static fn (array $message): bool => isset($wanted[(string) ($message['id'] ?? '')]),
            ));
            array_push($list, ...$this->presentMessages($window, $all, (string) $instance->uri));
        }

        return ['list' => $list, 'notFound' => $notFound];
    }

    /**
     * @param  array{id: string, body: string, parentId?: string|null}  $payload
     * @return array{message: array<string, mixed>, created: bool}
     */
    public function create(string $username, string $channelId, array $payload): array
    {
        $instance = $this->requireChannel($username, $channelId);
        $this->collectionAccess->assertCollectionWritable($instance, 'This channel is read-only.');

        $uid = ChatMessageJournalConverter::normalizeUlid((string) ($payload['id'] ?? ''));
        $body = (string) ($payload['body'] ?? '');
        if (trim($body) === '') {
            throw new ApiHttpException(400, 'body is required.', 'bad_request');
        }
        $this->converter->assertBodySize($body);

        // Idempotent create: the same ULID replayed into the same channel
        // returns the existing message instead of failing the retry.
        $existing = $this->findObjectByUid((int) $instance->calendarid, $uid);
        if ($existing !== null) {
            return ['message' => $this->presentSingle($existing, $instance), 'created' => false];
        }
        // A ULID that already lives in a DIFFERENT VJOURNAL collection is a
        // client bug (or an attempt to probe foreign ids) — refuse.
        if (CalendarObject::query()->where('uid', $uid)->where('componenttype', 'VJOURNAL')->exists()) {
            throw new ApiHttpException(409, 'A message with this id already exists.', 'alreadyExists');
        }

        $parentId = null;
        if (is_string($payload['parentId'] ?? null) && $payload['parentId'] !== '') {
            $parentId = ChatMessageJournalConverter::normalizeUlid($payload['parentId']);
            $parent = $this->findObjectByUid((int) $instance->calendarid, $parentId);
            if ($parent === null) {
                throw new ApiHttpException(400, 'parentId does not reference a message in this channel.', 'invalidProperties', ['parentId']);
            }
        }

        $ics = $this->converter->toIcs([
            'id' => $uid,
            'body' => $body,
            'author' => $username,
            'parentId' => $parentId,
        ], new DateTimeImmutable('now', new DateTimeZone('UTC')));

        try {
            $this->calBackend()->createCalendarObject(
                [(int) $instance->calendarid, (int) $instance->id],
                $uid.'.ics',
                $ics,
            );
        } catch (QueryException|PDOException $exception) {
            // Unique (calendarid, uid): a concurrent replay of the same ULID
            // lost the race — return the winner (same idempotency contract).
            $existing = $this->findObjectByUid((int) $instance->calendarid, $uid);
            if ($existing !== null) {
                return ['message' => $this->presentSingle($existing, $instance), 'created' => false];
            }
            throw $exception;
        }

        $object = $this->findObjectByUid((int) $instance->calendarid, $uid);
        if ($object === null) {
            throw new ApiHttpException(500, 'Could not load created message.', 'server_error');
        }

        return ['message' => $this->presentSingle($object, $instance), 'created' => true];
    }

    /**
     * Author body edit — STRICTLY author-only; bumps SEQUENCE.
     *
     * @return array<string, mixed>
     */
    public function edit(string $username, string $messageId, string $body): array
    {
        $located = $this->locateMessage($username, $messageId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Message not found.', 'not_found');
        }
        [$object, $instance] = $located;
        $this->collectionAccess->assertCollectionWritable($instance, 'This channel is read-only.');
        $message = $this->converter->fromObject($object, (string) $instance->uri);
        $this->assertAuthor($message, $username, 'Only the author can edit a message.');
        if (($message['deletedAt'] ?? null) !== null) {
            throw new ApiHttpException(400, 'Cannot edit a deleted message.', 'bad_request');
        }

        $ics = $this->converter->applyEdit(
            $this->rawIcs($object),
            $body,
            new DateTimeImmutable('now', new DateTimeZone('UTC')),
        );
        $this->calBackend()->updateCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            (string) $object->uri,
            $ics,
        );

        return $this->presentSingle($object->fresh(), $instance);
    }

    /**
     * Author-only idempotent delete tombstone (STATUS:CANCELLED) — the object
     * stays in place so threads keep integrity and the tombstone travels
     * through the changes feed as a normal modification.
     *
     * @return array{ok: true}
     */
    public function delete(string $username, string $messageId): array
    {
        $located = $this->locateMessage($username, $messageId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Message not found.', 'not_found');
        }
        [$object, $instance] = $located;
        $this->collectionAccess->assertCollectionWritable($instance, 'This channel is read-only.');
        $message = $this->converter->fromObject($object, (string) $instance->uri);
        $this->assertAuthor($message, $username, 'Only the author can delete a message.');
        if (($message['deletedAt'] ?? null) !== null) {
            return ['ok' => true];
        }

        $ics = $this->converter->applyTombstone(
            $this->rawIcs($object),
            new DateTimeImmutable('now', new DateTimeZone('UTC')),
        );
        $this->calBackend()->updateCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            (string) $object->uri,
            $ics,
        );

        return ['ok' => true];
    }

    /**
     * (emoji, author) set toggle. Read-modify-write inside a transaction with
     * a row lock on the calendarobjects row, so concurrent toggles from
     * different users merge like an OR-set. Never touches SEQUENCE.
     *
     * @return array<string, mixed>
     */
    public function toggleReaction(string $username, string $messageId, string $emoji): array
    {
        $emoji = trim($emoji);
        if ($emoji === '') {
            throw new ApiHttpException(400, 'emoji is required.', 'bad_request');
        }
        $located = $this->locateMessage($username, $messageId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Message not found.', 'not_found');
        }
        [$object, $instance] = $located;
        $this->collectionAccess->assertCollectionWritable($instance, 'This channel is read-only.');

        DB::connection('wgw')->transaction(function () use ($object, $instance, $username, $emoji): void {
            $locked = CalendarObject::query()->whereKey((int) $object->id)->lockForUpdate()->firstOrFail();
            $message = $this->converter->fromObject($locked, (string) $instance->uri);
            if (($message['deletedAt'] ?? null) !== null) {
                throw new ApiHttpException(400, 'Cannot react to a deleted message.', 'bad_request');
            }

            $reactions = $this->toggleReactionSet($message['reactions'] ?? [], $emoji, $username);
            $ics = $this->converter->applyReactions($this->rawIcs($locked), $reactions);
            $this->calBackend()->updateCalendarObject(
                [(int) $instance->calendarid, (int) $instance->id],
                (string) $locked->uri,
                $ics,
            );
        });

        return $this->presentSingle($object->fresh(), $instance);
    }

    /**
     * Object-level sync for one channel — same feed NoteRepository::changes
     * reads, but with honest hasMoreChanges at chat volume (ChatChangesFeed).
     *
     * @return array{oldState: string, newState: string, created: list<string>, updated: list<string>, destroyed: list<string>, hasMoreChanges: bool}
     */
    public function changes(string $username, string $channelId, ?string $since): array
    {
        $instance = $this->requireChannel($username, $channelId);

        return $this->changesFeed->changes($instance, $since, self::CHANGES_PAGE_SIZE);
    }

    /**
     * @return array{ok: true}
     */
    public function putReadMarker(string $username, string $channelId, string $lastReadTs, string $lastReadUid): array
    {
        $instance = $this->requireChannel($username, $channelId);
        try {
            $timestamp = (new DateTimeImmutable($lastReadTs))->getTimestamp();
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'lastReadTs must be a UTC date-time.', 'invalidProperties', ['lastReadTs']);
        }
        $uid = ChatMessageJournalConverter::normalizeUlid($lastReadUid);

        ChatReadMarker::query()->updateOrCreate(
            ['username' => $username, 'calendarid' => (int) $instance->calendarid],
            ['last_read_ts' => $timestamp, 'last_read_uid' => $uid],
        );

        return ['ok' => true];
    }

    private function requireChannel(string $username, string $channelId): CalendarInstance
    {
        $instance = $this->channels->findAccessibleChannel($username, $channelId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Channel not found.', 'not_found');
        }

        return $instance;
    }

    /**
     * @return array{0: CalendarObject, 1: CalendarInstance}|null
     */
    private function locateMessage(string $username, string $messageId): ?array
    {
        $objects = CalendarObject::query()
            ->where('uid', $messageId)
            ->where('componenttype', 'VJOURNAL')
            ->get();

        foreach ($objects as $object) {
            $instance = $this->channels->findAccessibleInstanceForCalendar($username, (int) $object->calendarid);
            if ($instance !== null) {
                return [$object, $instance];
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $message
     */
    private function assertAuthor(array $message, string $username, string $error): void
    {
        if (($message['authorId'] ?? '') !== $username) {
            throw new ApiHttpException(403, $error, 'forbidden');
        }
    }

    /**
     * All channel messages converted and sorted by (created_ts, uid) — the
     * fixed-width UTC format sorts lexicographically in chronological order.
     *
     * @return list<array<string, mixed>>
     */
    private function sortedChannelMessages(CalendarInstance $instance): array
    {
        $messages = [];
        $objects = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('componenttype', 'VJOURNAL')
            ->get();
        foreach ($objects as $object) {
            $messages[] = $this->converter->fromObject($object, (string) $instance->uri);
        }
        usort($messages, static function (array $a, array $b): int {
            return [(string) ($a['createdAt'] ?? ''), (string) ($a['id'] ?? '')]
                <=> [(string) ($b['createdAt'] ?? ''), (string) ($b['id'] ?? '')];
        });

        return $messages;
    }

    /**
     * @param  list<array<string, mixed>>  $messages
     */
    private function cursorPosition(array $messages, string $cursor): int
    {
        $uid = ChatMessageJournalConverter::normalizeUlid($cursor);
        foreach ($messages as $index => $message) {
            if (($message['id'] ?? null) === $uid) {
                return $index;
            }
        }

        throw new ApiHttpException(400, 'Unknown cursor message id.', 'bad_request');
    }

    /**
     * @param  list<array{emoji: string, authors: list<string>}>  $reactions
     * @return list<array{emoji: string, authors: list<string>}>
     */
    private function toggleReactionSet(array $reactions, string $emoji, string $username): array
    {
        $result = [];
        $found = false;
        foreach ($reactions as $reaction) {
            if (($reaction['emoji'] ?? null) !== $emoji) {
                $result[] = $reaction;

                continue;
            }
            $found = true;
            $authors = array_values(array_map('strval', $reaction['authors'] ?? []));
            $authors = in_array($username, $authors, true)
                ? array_values(array_diff($authors, [$username]))
                : [...$authors, $username];
            if ($authors !== []) {
                $result[] = ['emoji' => $emoji, 'authors' => $authors];
            }
        }
        if (! $found) {
            $result[] = ['emoji' => $emoji, 'authors' => [$username]];
        }

        return $result;
    }

    /**
     * @return array<string, mixed>
     */
    private function presentSingle(CalendarObject $object, CalendarInstance $instance): array
    {
        $all = $this->sortedChannelMessages($instance);
        $message = $this->converter->fromObject($object, (string) $instance->uri);

        return $this->presentMessages([$message], $all, (string) $instance->uri)[0];
    }

    /**
     * Contract shape: replyCount is derived from the live thread (children
     * that are not tombstones), authorName from the principal directory,
     * mentions stay client-side in v1.
     *
     * @param  list<array<string, mixed>>  $window
     * @param  list<array<string, mixed>>  $all
     * @return list<array<string, mixed>>
     */
    private function presentMessages(array $window, array $all, string $channelId): array
    {
        $replyCounts = [];
        foreach ($all as $message) {
            $parentId = $message['parentId'] ?? null;
            if (is_string($parentId) && $parentId !== '' && ($message['deletedAt'] ?? null) === null) {
                $replyCounts[$parentId] = ($replyCounts[$parentId] ?? 0) + 1;
            }
        }

        $names = $this->displayNames(array_values(array_unique(array_map(
            static fn (array $message): string => (string) ($message['authorId'] ?? ''),
            $window,
        ))));

        $presented = [];
        foreach ($window as $message) {
            $authorId = (string) ($message['authorId'] ?? '');
            $presented[] = [
                'id' => (string) $message['id'],
                'channelId' => $channelId,
                'authorId' => $authorId,
                'authorName' => $names[$authorId] ?? $authorId,
                'body' => (string) ($message['body'] ?? ''),
                'createdAt' => (string) ($message['createdAt'] ?? ''),
                'editedAt' => $message['editedAt'] ?? null,
                'deletedAt' => $message['deletedAt'] ?? null,
                'parentId' => $message['parentId'] ?? null,
                'replyCount' => $replyCounts[(string) $message['id']] ?? 0,
                'reactions' => $message['reactions'] ?? [],
                'mentions' => [],
            ];
        }

        return $presented;
    }

    /**
     * @param  list<string>  $usernames
     * @return array<string, string>
     */
    private function displayNames(array $usernames): array
    {
        $usernames = array_values(array_filter($usernames, static fn (string $name): bool => $name !== ''));
        if ($usernames === []) {
            return [];
        }

        $names = [];
        $principals = Principal::query()
            ->whereIn('uri', array_map(static fn (string $name): string => 'principals/'.$name, $usernames))
            ->get(['uri', 'displayname']);
        foreach ($principals as $principal) {
            $username = substr((string) $principal->uri, strlen('principals/'));
            $display = trim((string) ($principal->displayname ?? ''));
            $names[$username] = $display !== '' ? $display : $username;
        }

        return $names;
    }

    private function findObjectByUid(int $calendarId, string $uid): ?CalendarObject
    {
        return CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uid', $uid)
            ->first();
    }

    private function rawIcs(CalendarObject $object): string
    {
        return is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
