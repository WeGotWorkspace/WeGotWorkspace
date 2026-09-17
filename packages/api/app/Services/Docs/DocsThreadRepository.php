<?php

declare(strict_types=1);

namespace App\Services\Docs;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\DocsThreadIndex;
use App\Models\Principal;
use App\Services\Docs\Conversion\DocsThreadJournalConverter;
use App\Services\Drive\CollabDocFormats;
use App\Services\Drive\DriveShareAuthorizer;
use App\Storage\StoragePaths;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use PDOException;
use Sabre\CalDAV\Backend\PDO as CalPDO;

/**
 * Docs comment + suggestion threads as VJOURNAL objects in a hidden owner pool.
 *
 * Mutations go through the Sabre calendar backend so they surface in
 * calendarchanges. ACL is DriveShareAuthorizer only — no calendar share roster.
 */
final class DocsThreadRepository
{
    public const CHANGES_PAGE_SIZE = 200;

    public function __construct(
        private readonly DocsThreadJournalConverter $converter,
        private readonly DocsThreadPoolProvisioner $pools,
        private readonly DocsThreadEventEmitter $events,
        private readonly DriveShareAuthorizer $authorizer,
        private readonly StoragePaths $paths,
        private readonly CollabDocFormats $collabDocs,
    ) {}

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array{list: list<array<string, mixed>>}
     */
    public function list(array $principal, string $path): array
    {
        $path = $this->requireReadableDocPath($path, $principal);
        $instance = $this->pools->findPool(DocsThreadCollectionUris::ownerPrincipalUri($path));
        if ($instance === null) {
            return ['list' => []];
        }

        return ['list' => $this->assembleThreads($instance, $path)];
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @param  array<string, mixed>  $payload
     * @return array{thread: array<string, mixed>, created: bool}
     */
    public function create(array $principal, string $path, array $payload): array
    {
        $path = $this->requireMutableDocPath($path, $principal);
        $kind = (string) ($payload['kind'] ?? '');
        if (! in_array($kind, [DocsThreadJournalConverter::KIND_COMMENT, DocsThreadJournalConverter::KIND_SUGGESTION], true)) {
            throw new ApiHttpException(400, 'kind must be comment or suggestion.', 'invalidProperties', ['kind']);
        }
        $changeId = isset($payload['changeId']) && is_string($payload['changeId']) && $payload['changeId'] !== ''
            ? $payload['changeId']
            : null;
        if ($kind === DocsThreadJournalConverter::KIND_SUGGESTION && $changeId === null) {
            throw new ApiHttpException(400, 'changeId is required for suggestion threads.', 'invalidProperties', ['changeId']);
        }

        $uid = DocsThreadJournalConverter::normalizeUlid((string) ($payload['id'] ?? ''));
        $body = (string) ($payload['body'] ?? '');
        if (trim($body) === '' && $kind !== DocsThreadJournalConverter::KIND_SUGGESTION) {
            throw new ApiHttpException(400, 'body is required.', 'bad_request');
        }
        $this->converter->assertBodySize($body);

        $instance = $this->pools->ensureForOwner(DocsThreadCollectionUris::ownerPrincipalUri($path));

        $existing = $this->findObjectByUid((int) $instance->calendarid, $uid);
        if ($existing !== null) {
            return ['thread' => $this->presentThread($instance, $path, $uid), 'created' => false];
        }
        if (CalendarObject::query()->where('uid', $uid)->where('componenttype', 'VJOURNAL')->exists()) {
            throw new ApiHttpException(409, 'A thread with this id already exists.', 'alreadyExists');
        }

        $ics = $this->converter->toIcs([
            'id' => $uid,
            'body' => $body,
            'author' => $principal['username'],
            'docPath' => $path,
            'kind' => $kind,
            'changeId' => $changeId,
            'anchorText' => is_string($payload['anchorText'] ?? null) ? (string) $payload['anchorText'] : '',
            'anchorFrom' => is_int($payload['anchorFrom'] ?? null) ? $payload['anchorFrom'] : null,
            'anchorTo' => is_int($payload['anchorTo'] ?? null) ? $payload['anchorTo'] : null,
            'anchorOccurrence' => is_int($payload['anchorOccurrence'] ?? null) ? $payload['anchorOccurrence'] : null,
        ], new DateTimeImmutable('now', new DateTimeZone('UTC')));

        $created = $this->writeObject($instance, $uid, $ics);
        if ($created) {
            DocsThreadIndex::query()->create([
                'calendarid' => (int) $instance->calendarid,
                'uid' => $uid,
                'doc_path' => $path,
                'kind' => $kind,
                'parent_uid' => null,
                'change_id' => $changeId,
            ]);
            if (trim($body) !== '') {
                $this->events->posted($kind, $path, $uid, $uid, $principal['username']);
            }
        }

        return ['thread' => $this->presentThread($instance, $path, $uid), 'created' => $created];
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @param  array{id: string, body: string}  $payload
     * @return array<string, mixed>
     */
    public function reply(array $principal, string $path, string $threadId, array $payload): array
    {
        $path = $this->requireMutableDocPath($path, $principal);
        $rootUid = DocsThreadJournalConverter::normalizeUlid($threadId);
        $instance = $this->requirePoolForPath($path);
        $root = $this->requireRootOnPath($instance, $path, $rootUid);

        $uid = DocsThreadJournalConverter::normalizeUlid((string) ($payload['id'] ?? ''));
        $body = (string) ($payload['body'] ?? '');
        if (trim($body) === '') {
            throw new ApiHttpException(400, 'body is required.', 'bad_request');
        }
        $this->converter->assertBodySize($body);

        $existing = $this->findObjectByUid((int) $instance->calendarid, $uid);
        if ($existing !== null) {
            return $this->presentThread($instance, $path, $rootUid);
        }
        if (CalendarObject::query()->where('uid', $uid)->where('componenttype', 'VJOURNAL')->exists()) {
            throw new ApiHttpException(409, 'A message with this id already exists.', 'alreadyExists');
        }

        $ics = $this->converter->toIcs([
            'id' => $uid,
            'body' => $body,
            'author' => $principal['username'],
            'docPath' => $path,
            'parentId' => $rootUid,
        ], new DateTimeImmutable('now', new DateTimeZone('UTC')));

        if ($this->writeObject($instance, $uid, $ics)) {
            DocsThreadIndex::query()->create([
                'calendarid' => (int) $instance->calendarid,
                'uid' => $uid,
                'doc_path' => $path,
                'kind' => DocsThreadIndex::KIND_REPLY,
                'parent_uid' => $rootUid,
                'change_id' => null,
            ]);
            $kind = (string) ($root['kind'] ?? DocsThreadJournalConverter::KIND_COMMENT);
            $this->events->posted($kind, $path, $rootUid, $uid, $principal['username']);
        }

        return $this->presentThread($instance, $path, $rootUid);
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array<string, mixed>
     */
    public function toggleReaction(array $principal, string $path, string $threadId, string $emoji): array
    {
        $path = $this->requireMutableDocPath($path, $principal);
        $emoji = trim($emoji);
        if ($emoji === '') {
            throw new ApiHttpException(400, 'emoji is required.', 'bad_request');
        }
        $rootUid = DocsThreadJournalConverter::normalizeUlid($threadId);
        $instance = $this->requirePoolForPath($path);
        $this->requireRootOnPath($instance, $path, $rootUid);
        $object = $this->findObjectByUid((int) $instance->calendarid, $rootUid);
        if ($object === null) {
            throw new ApiHttpException(404, 'Thread not found.', 'not_found');
        }

        DB::connection('wgw')->transaction(function () use ($object, $instance, $principal, $emoji): void {
            $locked = CalendarObject::query()->whereKey((int) $object->id)->lockForUpdate()->firstOrFail();
            $message = $this->converter->fromObject($locked);
            $reactions = $this->toggleReactionSet($message['reactions'] ?? [], $emoji, $principal['username']);
            $ics = $this->converter->applyReactions($this->rawIcs($locked), $reactions);
            $this->calBackend()->updateCalendarObject(
                [(int) $instance->calendarid, (int) $instance->id],
                (string) $locked->uri,
                $ics,
            );
        });

        return $this->presentThread($instance, $path, $rootUid);
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @param  array{resolved?: bool, archived?: bool, changeId?: string, anchorText?: string, anchorFrom?: int, anchorTo?: int}  $payload
     * @return array<string, mixed>
     */
    public function patch(array $principal, string $path, string $threadId, array $payload): array
    {
        $path = $this->requireMutableDocPath($path, $principal);
        $instance = $this->requirePoolForPath($path);

        $changeId = isset($payload['changeId']) && is_string($payload['changeId']) && $payload['changeId'] !== ''
            ? $payload['changeId']
            : null;
        if ($changeId !== null) {
            $rootUid = $this->rootUidForChangeId($instance, $path, $changeId);
        } else {
            $rootUid = DocsThreadJournalConverter::normalizeUlid($threadId);
        }
        $root = $this->requireRootOnPath($instance, $path, $rootUid);
        $object = $this->findObjectByUid((int) $instance->calendarid, $rootUid);
        if ($object === null) {
            throw new ApiHttpException(404, 'Thread not found.', 'not_found');
        }

        $ics = $this->rawIcs($object);
        if (array_key_exists('resolved', $payload)) {
            $ics = $this->converter->applyResolved($ics, (bool) $payload['resolved']);
        }
        if (array_key_exists('archived', $payload)) {
            if (($root['kind'] ?? '') !== DocsThreadJournalConverter::KIND_SUGGESTION && (bool) $payload['archived'] === true) {
                throw new ApiHttpException(400, 'Only suggestion threads can be archived.', 'bad_request');
            }
            $ics = $this->converter->applyArchived($ics, (bool) $payload['archived']);
        }
        if (
            array_key_exists('anchorText', $payload)
            || array_key_exists('anchorFrom', $payload)
            || array_key_exists('anchorTo', $payload)
        ) {
            $ics = $this->converter->applyAnchors($ics, [
                'anchorText' => is_string($payload['anchorText'] ?? null) ? $payload['anchorText'] : null,
                'anchorFrom' => is_int($payload['anchorFrom'] ?? null) ? $payload['anchorFrom'] : null,
                'anchorTo' => is_int($payload['anchorTo'] ?? null) ? $payload['anchorTo'] : null,
            ]);
        }
        $this->calBackend()->updateCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            (string) $object->uri,
            $ics,
        );

        return $this->presentThread($instance, $path, $rootUid);
    }

    /**
     * Archive every non-archived suggestion root whose changeId is not in $activeChangeIds.
     *
     * @param  array{username: string, role: string}  $principal
     * @param  list<string>  $activeChangeIds
     */
    public function archiveOrphanSuggestions(array $principal, string $path, array $activeChangeIds): void
    {
        $path = $this->requireMutableDocPath($path, $principal);
        $instance = $this->pools->findPool(DocsThreadCollectionUris::ownerPrincipalUri($path));
        if ($instance === null) {
            return;
        }
        $active = array_fill_keys($activeChangeIds, true);
        foreach ($this->assembleThreads($instance, $path) as $thread) {
            if (($thread['kind'] ?? '') !== DocsThreadJournalConverter::KIND_SUGGESTION) {
                continue;
            }
            if (($thread['archived'] ?? false) === true) {
                continue;
            }
            $changeId = $thread['changeId'] ?? null;
            if (! is_string($changeId) || $changeId === '' || isset($active[$changeId])) {
                continue;
            }
            $this->patch($principal, $path, (string) $thread['id'], ['archived' => true]);
        }
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array{oldState: string, newState: string, created: list<string>, updated: list<string>, destroyed: list<string>, hasMoreChanges: bool}
     */
    public function changes(array $principal, string $path, ?string $since): array
    {
        $path = $this->requireReadableDocPath($path, $principal);
        $instance = $this->pools->findPool(DocsThreadCollectionUris::ownerPrincipalUri($path));
        if ($instance === null) {
            return [
                'oldState' => ($since === null || $since === '') ? '0' : $since,
                'newState' => '0',
                'created' => [],
                'updated' => [],
                'destroyed' => [],
                'hasMoreChanges' => false,
            ];
        }

        $syncToken = $this->normalizeSyncToken($since);
        $changes = $this->calBackend()->getChangesForCalendar(
            [(int) $instance->calendarid, (int) $instance->id],
            $syncToken,
            1,
            self::CHANGES_PAGE_SIZE,
        );
        if ($changes === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        $onPath = $this->uidsOnPath((int) $instance->calendarid, $path);

        return [
            'oldState' => ($since === null || $since === '') ? '0' : $since,
            'newState' => (string) $changes['syncToken'],
            'created' => $this->filterUidsForPath((int) $instance->calendarid, $changes['added'] ?? [], $onPath),
            'updated' => $this->filterUidsForPath((int) $instance->calendarid, $changes['modified'] ?? [], $onPath),
            'destroyed' => array_values(array_filter(
                $this->destroyedUids($changes['deleted'] ?? []),
                static fn (string $uid): bool => isset($onPath[$uid]),
            )),
            'hasMoreChanges' => ($changes['result_truncated'] ?? false) === true,
        ];
    }

    public function retargetPath(string $from, string $to): void
    {
        $from = $this->paths->normalizeVirtualPath($from);
        $to = $this->paths->normalizeVirtualPath($to);
        $rows = DocsThreadIndex::query()
            ->where('doc_path', $from)
            ->orWhere('doc_path', 'like', $from.'/%')
            ->get();
        foreach ($rows as $row) {
            $newPath = (string) $row->doc_path === $from
                ? $to
                : $to.substr((string) $row->doc_path, strlen($from));
            $instance = CalendarInstance::query()
                ->where('calendarid', (int) $row->calendarid)
                ->where('uri', DocsThreadCollectionUris::POOL_URI)
                ->first();
            $object = $this->findObjectByUid((int) $row->calendarid, (string) $row->uid);
            if ($instance !== null && $object !== null) {
                $ics = $this->converter->applyDocPath($this->rawIcs($object), $newPath);
                $this->calBackend()->updateCalendarObject(
                    [(int) $instance->calendarid, (int) $instance->id],
                    (string) $object->uri,
                    $ics,
                );
            }
            $row->doc_path = $newPath;
            $row->save();
        }
    }

    public function dropPath(string $path): void
    {
        $path = $this->paths->normalizeVirtualPath($path);
        $rows = DocsThreadIndex::query()
            ->where('doc_path', $path)
            ->orWhere('doc_path', 'like', $path.'/%')
            ->get();
        foreach ($rows as $row) {
            $instance = CalendarInstance::query()
                ->where('calendarid', (int) $row->calendarid)
                ->where('uri', DocsThreadCollectionUris::POOL_URI)
                ->first();
            $object = $this->findObjectByUid((int) $row->calendarid, (string) $row->uid);
            if ($instance !== null && $object !== null) {
                $this->calBackend()->deleteCalendarObject(
                    [(int) $instance->calendarid, (int) $instance->id],
                    (string) $object->uri,
                );
            }
            $row->delete();
        }
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    private function requireReadableDocPath(string $path, array $principal): string
    {
        $path = $this->paths->normalizeVirtualPath($path);
        $this->assertCollabDoc($path);
        try {
            $this->authorizer->assertMayRead($path, $principal);
        } catch (\InvalidArgumentException) {
            throw new ApiHttpException(403, 'Access denied for this path.', 'forbidden');
        }

        return $path;
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    private function requireMutableDocPath(string $path, array $principal): string
    {
        $path = $this->paths->normalizeVirtualPath($path);
        $this->assertCollabDoc($path);
        try {
            $this->authorizer->assertMayComment($path, $principal);
        } catch (\InvalidArgumentException) {
            throw new ApiHttpException(403, 'Access denied for this path.', 'forbidden');
        }

        return $path;
    }

    private function assertCollabDoc(string $path): void
    {
        if (! $this->collabDocs->isCollabDocPath($path)) {
            throw new ApiHttpException(400, 'Threads are only available on Docs files.', 'bad_request');
        }
    }

    private function requirePoolForPath(string $path): CalendarInstance
    {
        $instance = $this->pools->findPool(DocsThreadCollectionUris::ownerPrincipalUri($path));
        if ($instance === null) {
            throw new ApiHttpException(404, 'Thread not found.', 'not_found');
        }

        return $instance;
    }

    /**
     * @return array<string, mixed>
     */
    private function requireRootOnPath(CalendarInstance $instance, string $path, string $rootUid): array
    {
        $object = $this->findObjectByUid((int) $instance->calendarid, $rootUid);
        if ($object === null) {
            throw new ApiHttpException(404, 'Thread not found.', 'not_found');
        }
        $message = $this->converter->fromObject($object);
        if (($message['parentId'] ?? null) !== null) {
            throw new ApiHttpException(400, 'Replies cannot be used as thread roots.', 'bad_request');
        }
        if (($message['docPath'] ?? '') !== $path) {
            throw new ApiHttpException(404, 'Thread not found.', 'not_found');
        }

        return $message;
    }

    private function rootUidForChangeId(CalendarInstance $instance, string $path, string $changeId): string
    {
        $row = DocsThreadIndex::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('doc_path', $path)
            ->where('change_id', $changeId)
            ->whereNull('parent_uid')
            ->first();
        if ($row === null) {
            throw new ApiHttpException(404, 'Thread not found.', 'not_found');
        }

        return (string) $row->uid;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function assembleThreads(CalendarInstance $instance, string $path): array
    {
        $uids = DocsThreadIndex::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('doc_path', $path)
            ->pluck('uid')
            ->all();
        if ($uids === []) {
            return [];
        }

        $messages = [];
        $objects = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->whereIn('uid', $uids)
            ->get();
        foreach ($objects as $object) {
            $messages[] = $this->converter->fromObject($object);
        }

        $repliesByParent = [];
        $roots = [];
        foreach ($messages as $message) {
            $parentId = $message['parentId'] ?? null;
            if (is_string($parentId) && $parentId !== '') {
                $repliesByParent[$parentId][] = $message;

                continue;
            }
            $roots[] = $message;
        }

        $names = $this->displayNames(array_values(array_unique(array_filter(array_map(
            static fn (array $message): string => (string) ($message['authorId'] ?? ''),
            $messages,
        )))));

        $threads = [];
        foreach ($roots as $root) {
            $kind = (string) ($root['kind'] ?? DocsThreadJournalConverter::KIND_COMMENT);
            $archived = (bool) ($root['archived'] ?? false);
            $rootId = (string) $root['id'];
            $children = $repliesByParent[$rootId] ?? [];
            usort($children, static function (array $a, array $b): int {
                return [(string) ($a['createdAt'] ?? ''), (string) ($a['id'] ?? '')]
                    <=> [(string) ($b['createdAt'] ?? ''), (string) ($b['id'] ?? '')];
            });
            $authorId = (string) ($root['authorId'] ?? '');
            $messagesOut = [
                $this->presentMessage($root, $names),
                ...array_map(fn (array $reply): array => $this->presentMessage($reply, $names), $children),
            ];
            $reactions = [];
            foreach ($root['reactions'] ?? [] as $reaction) {
                $reactions[] = [
                    'emoji' => (string) ($reaction['emoji'] ?? ''),
                    'userIds' => array_values(array_map('strval', $reaction['authors'] ?? [])),
                ];
            }
            $threads[] = [
                'id' => $rootId,
                'kind' => $kind,
                'path' => $path,
                'changeId' => $kind === DocsThreadJournalConverter::KIND_SUGGESTION
                    ? ($root['changeId'] ?? null)
                    : null,
                'anchorText' => (string) ($root['anchorText'] ?? ''),
                'anchorFrom' => $root['anchorFrom'] ?? null,
                'anchorTo' => $root['anchorTo'] ?? null,
                'anchorOccurrence' => $root['anchorOccurrence'] ?? null,
                'createdAt' => (string) ($root['createdAt'] ?? ''),
                'createdBy' => [
                    'id' => $authorId,
                    'name' => $names[$authorId] ?? $authorId,
                ],
                'resolved' => (bool) ($root['resolved'] ?? false),
                'archived' => $archived,
                'messages' => $messagesOut,
                'reactions' => $reactions,
            ];
        }
        usort($threads, static function (array $a, array $b): int {
            return [(string) ($a['createdAt'] ?? ''), (string) ($a['id'] ?? '')]
                <=> [(string) ($b['createdAt'] ?? ''), (string) ($b['id'] ?? '')];
        });

        return $threads;
    }

    /**
     * @return array<string, mixed>
     */
    private function presentThread(CalendarInstance $instance, string $path, string $rootUid): array
    {
        foreach ($this->assembleThreads($instance, $path) as $thread) {
            if (($thread['id'] ?? '') === $rootUid) {
                return $thread;
            }
        }

        throw new ApiHttpException(404, 'Thread not found.', 'not_found');
    }

    /**
     * @param  array<string, mixed>  $message
     * @param  array<string, string>  $names
     * @return array<string, mixed>
     */
    private function presentMessage(array $message, array $names): array
    {
        $authorId = (string) ($message['authorId'] ?? '');

        return [
            'id' => (string) ($message['id'] ?? ''),
            'body' => (string) ($message['body'] ?? ''),
            'createdAt' => (string) ($message['createdAt'] ?? ''),
            'author' => [
                'id' => $authorId,
                'name' => $names[$authorId] ?? $authorId,
            ],
        ];
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

    private function writeObject(CalendarInstance $instance, string $uid, string $ics): bool
    {
        try {
            $this->calBackend()->createCalendarObject(
                [(int) $instance->calendarid, (int) $instance->id],
                $uid.'.ics',
                $ics,
            );

            return true;
        } catch (QueryException|PDOException) {
            if ($this->findObjectByUid((int) $instance->calendarid, $uid) !== null) {
                return false;
            }
            throw new ApiHttpException(500, 'Could not persist thread.', 'server_error');
        }
    }

    private function findObjectByUid(int $calendarId, string $uid): ?CalendarObject
    {
        return CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uid', $uid)
            ->first();
    }

    /**
     * @return array<string, true>
     */
    private function uidsOnPath(int $calendarId, string $path): array
    {
        $map = [];
        foreach (DocsThreadIndex::query()->where('calendarid', $calendarId)->where('doc_path', $path)->pluck('uid') as $uid) {
            $map[(string) $uid] = true;
        }

        return $map;
    }

    /**
     * @param  list<string>  $uris
     * @param  array<string, true>  $onPath
     * @return list<string>
     */
    private function filterUidsForPath(int $calendarId, array $uris, array $onPath): array
    {
        $uids = [];
        foreach ($uris as $uri) {
            $uri = (string) $uri;
            if ($uri === '') {
                continue;
            }
            $object = CalendarObject::query()
                ->where('calendarid', $calendarId)
                ->where('uri', $uri)
                ->first(['uid']);
            if ($object === null || ! is_string($object->uid) || $object->uid === '') {
                continue;
            }
            if (isset($onPath[(string) $object->uid])) {
                $uids[] = (string) $object->uid;
            }
        }

        return $uids;
    }

    /**
     * @param  list<string>  $uris
     * @return list<string>
     */
    private function destroyedUids(array $uris): array
    {
        $uids = [];
        foreach ($uris as $uri) {
            $uri = (string) $uri;
            if ($uri === '') {
                continue;
            }
            $uids[] = str_ends_with($uri, '.ics') ? substr($uri, 0, -4) : $uri;
        }

        return array_values(array_unique($uids));
    }

    private function normalizeSyncToken(?string $since): ?int
    {
        if ($since === null || $since === '' || $since === '0') {
            return null;
        }
        if (! ctype_digit($since)) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        return (int) $since;
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
