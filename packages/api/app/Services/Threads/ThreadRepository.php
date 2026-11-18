<?php

declare(strict_types=1);

namespace App\Services\Threads;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\ThreadIndex;
use Illuminate\Database\Eloquent\Builder;

/**
 * The shared thread service (#2173, docs/architecture/threads.md). Every call
 * takes a subject its type already resolved for the caller, so access is
 * settled before anything here runs. Nothing here names an app.
 *
 * - Entries are read and written only under the subject's current key; an
 *   entry id from another key answers 404 and writes nothing.
 * - A post follows the order in spec.md: the caller's own ULID under the
 *   current key replays (200), under an earlier key is 409 `already_stored`,
 *   then 403 without `canPost`, then 409 `subject_moved` for a stale
 *   `scopeId`, then the insert (under a fresh id when the ULID is taken).
 * - Lists sort and page by (created_at, uid): arrival, never the client clock.
 */
final class ThreadRepository
{
    public const PAGE_SIZE = 200;

    public const MAX_ENTRIES = 5000;

    public function __construct(
        private readonly ThreadPoolProvisioner $pools,
        private readonly ThreadEntryStore $store,
        private readonly ThreadEntryPresenter $presenter,
    ) {}

    /**
     * @return array{list: list<array<string, mixed>>, nextCursor: string|null, state: string, canPost: bool}
     */
    public function list(ThreadSubject $subject, ?string $cursor): array
    {
        $pool = $this->pools->find($subject->type, $subject->poolOwner);
        if ($pool === null) {
            return ['list' => [], 'nextCursor' => null, 'state' => '0', 'canPost' => $subject->canPost];
        }

        $query = $this->threadRows($pool, $subject)->orderBy('created_at')->orderBy('uid');
        if ($cursor !== null && $cursor !== '') {
            [$createdAt, $uid] = self::decodeCursor($cursor);
            $query->where(static fn (Builder $q) => $q
                ->where('created_at', '>', $createdAt)
                ->orWhere(static fn (Builder $same) => $same->where('created_at', $createdAt)->where('uid', '>', $uid)));
        }
        $rows = array_values($query->limit(self::PAGE_SIZE + 1)->get()->all());
        $next = null;
        if (count($rows) > self::PAGE_SIZE) {
            $rows = array_slice($rows, 0, self::PAGE_SIZE);
            $last = $rows[self::PAGE_SIZE - 1];
            $next = self::encodeCursor((string) $last->created_at, $last->uid);
        }

        return [
            'list' => $this->presenter->present($rows),
            'nextCursor' => $next,
            'state' => $this->state($pool, $subject),
            'canPost' => $subject->canPost,
        ];
    }

    /**
     * @param  array{id: string, body: string, parentId?: string|null, mentions?: list<array{id: string, displayName?: string}>, scopeId?: string|null}  $payload
     * @return array{entry: array<string, mixed>, created: bool}
     */
    public function post(ThreadSubjectType $type, ThreadSubject $subject, string $username, array $payload): array
    {
        $uid = ThreadEntryJournal::normalizeUlid($payload['id'], 'Entry');
        $own = fn (): ?ThreadIndex => $this->ownStoredEntry($subject, $username, $uid);

        $stored = $own();
        if ($stored !== null) {
            return $this->replay($subject, $stored);
        }
        $this->assertCanPost($subject);
        $scopeId = $payload['scopeId'] ?? null;
        if (is_string($scopeId) && $scopeId !== '' && $scopeId !== $subject->scopeId) {
            throw new ApiHttpException(409, 'This thread moved since the comment was written.', 'subject_moved');
        }

        $body = $payload['body'];
        if (trim($body) === '') {
            throw new ApiHttpException(400, 'body is required.', 'invalidProperties', ['body']);
        }
        $this->store->journal()->assertBodySize($body);

        $pool = $this->pools->ensure($subject->type, $subject->poolOwner);
        $parentUid = $this->requireParent($pool, $subject, $payload['parentId'] ?? null);
        if ($this->threadRows($pool, $subject)->count() >= self::MAX_ENTRIES) {
            throw new ApiHttpException(409, 'This thread is full.', 'thread_full');
        }

        $storeUid = $this->store->uidIsFree($uid) ? $uid : ThreadEntryStore::freshUid();
        $result = $this->store->insert($pool, $subject, $storeUid, [
            'body' => $body,
            'author' => $username,
            'kind' => $parentUid === null ? ThreadIndex::KIND_COMMENT : ThreadIndex::KIND_REPLY,
            'parentUid' => $parentUid,
            'mentions' => $this->mentionsInAudience($type, $subject, $payload['mentions'] ?? []),
            'activity' => null,
        ], $storeUid === $uid ? $own : static fn (): ?ThreadIndex => null);
        if (! $result['created']) {
            return $this->replay($subject, $result['row']);
        }

        return ['entry' => $this->presenter->presentOne($result['row']), 'created' => true];
    }

    /**
     * A server-written activity entry, such as "moved here" (#2173). Nobody
     * can edit, delete or react to it through the API.
     *
     * @param  array<string, mixed>  $activity  {field, …}
     */
    public function appendActivity(ThreadSubject $subject, string $actor, array $activity): void
    {
        $pool = $this->pools->ensure($subject->type, $subject->poolOwner);
        $this->store->insert($pool, $subject, ThreadEntryStore::freshUid(), [
            'body' => '',
            'author' => $actor,
            'kind' => ThreadIndex::KIND_ACTIVITY,
            'parentUid' => null,
            'mentions' => [],
            'activity' => $activity,
        ], static fn (): ?ThreadIndex => null);
    }

    /** @return array<string, mixed> */
    public function edit(ThreadSubject $subject, string $username, string $entryId, string $body): array
    {
        [$pool, $row] = $this->requireOwnWritable($subject, $username, $entryId);
        $this->store->rewrite($pool, $row, function (string $ics) use ($body): string {
            [, $journal] = $this->store->journal()->read($ics);
            if ($this->store->journal()->isTombstoned($journal)) {
                throw new ApiHttpException(409, 'This entry was deleted.', 'conflict');
            }
            if (trim($body) === '') {
                throw new ApiHttpException(400, 'body is required.', 'invalidProperties', ['body']);
            }

            return $this->store->journal()->applyEdit($ics, $body, new \DateTimeImmutable('now', new \DateTimeZone('UTC')));
        });

        return $this->presenter->presentOne($row);
    }

    /** @return array<string, mixed> */
    public function delete(ThreadSubject $subject, string $username, string $entryId): array
    {
        [$pool, $row] = $this->requireOwnWritable($subject, $username, $entryId);
        $this->store->rewrite($pool, $row, fn (string $ics): string => $this->store->journal()->applyTombstone(
            $ics,
            new \DateTimeImmutable('now', new \DateTimeZone('UTC')),
        ));

        return $this->presenter->presentOne($row);
    }

    /** @return array<string, mixed> */
    public function toggleReaction(ThreadSubject $subject, string $username, string $entryId, string $emoji): array
    {
        $this->assertCanPost($subject);
        [$pool, $row] = $this->requireEntry($subject, $entryId);
        if ($row->kind === ThreadIndex::KIND_ACTIVITY) {
            throw new ApiHttpException(409, 'Activity entries cannot be changed.', 'conflict');
        }
        $emoji = trim($emoji);
        if ($emoji === '') {
            throw new ApiHttpException(400, 'emoji is required.', 'invalidProperties', ['emoji']);
        }
        $this->store->rewrite($pool, $row, function (string $ics) use ($emoji, $username): string {
            [, $journal] = $this->store->journal()->read($ics);
            if ($this->store->journal()->isTombstoned($journal)) {
                throw new ApiHttpException(409, 'This entry was deleted.', 'conflict');
            }
            $reactions = ThreadReactions::toggle($this->store->journal()->reactionsOf($journal), $emoji, $username);

            return $this->store->journal()->applyReactions($ics, $reactions);
        });

        return $this->presenter->presentOne($row);
    }

    /**
     * Entries changed since $since. Entries are never removed one by one in
     * this chunk, so `removed` is empty; pruning (chunk F) fills it.
     *
     * A state reads `<pool>:<scope>:<modseq>`. One from another pool or scope
     * (the thread moved with its list, or to another list) cannot be compared
     * with this thread's modseq values: `cannotCalculateChanges`.
     *
     * @return array{oldState: string, newState: string, changed: list<string>, removed: list<string>, hasMoreChanges: bool}
     */
    public function changes(ThreadSubject $subject, ?string $since): array
    {
        $initial = $since === null || $since === '' || $since === '0';
        $pool = $this->pools->find($subject->type, $subject->poolOwner);
        $oldModseq = 0;
        if (! $initial) {
            $parts = explode(':', (string) $since, 3);
            if (count($parts) !== 3 || ! ctype_digit($parts[0]) || ! ctype_digit($parts[2])
                || $pool === null || (int) $parts[0] !== (int) $pool->calendarid || $parts[1] !== $subject->scope) {
                throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
            }
            $oldModseq = (int) $parts[2];
        }
        $old = $initial ? '0' : (string) $since;
        if ($pool === null) {
            return ['oldState' => $old, 'newState' => $old, 'changed' => [], 'removed' => [], 'hasMoreChanges' => false];
        }

        $rows = array_values($this->threadRows($pool, $subject)
            ->where('modseq', '>', $oldModseq)
            ->orderBy('modseq')
            ->orderBy('uid')
            ->limit(self::PAGE_SIZE + 1)
            ->get(['uid', 'modseq'])
            ->all());
        $more = count($rows) > self::PAGE_SIZE;
        $rows = array_slice($rows, 0, self::PAGE_SIZE);
        $last = $rows === [] ? null : $rows[count($rows) - 1];
        $newModseq = $more && $last !== null
            ? (int) $last->modseq
            : max($this->maxModseq($pool, $subject), $oldModseq);

        return [
            'oldState' => $old,
            'newState' => $this->formatState($pool, $subject, $newModseq),
            'changed' => array_map(static fn (ThreadIndex $row): string => $row->uid, $rows),
            'removed' => [],
            'hasMoreChanges' => $more,
        ];
    }

    /**
     * @return Builder<ThreadIndex>
     */
    private function threadRows(CalendarInstance $pool, ThreadSubject $subject): Builder
    {
        return ThreadIndex::query()
            ->where('pool_calendarid', (int) $pool->calendarid)
            ->where('subject_key', $subject->key());
    }

    private function state(CalendarInstance $pool, ThreadSubject $subject): string
    {
        return $this->formatState($pool, $subject, $this->maxModseq($pool, $subject));
    }

    private function maxModseq(CalendarInstance $pool, ThreadSubject $subject): int
    {
        return (int) $this->threadRows($pool, $subject)->max('modseq');
    }

    private function formatState(CalendarInstance $pool, ThreadSubject $subject, int $modseq): string
    {
        return (int) $pool->calendarid.':'.$subject->scope.':'.$modseq;
    }

    /**
     * The caller's own entry with this ULID for this subject, under any key.
     */
    private function ownStoredEntry(ThreadSubject $subject, string $username, string $uid): ?ThreadIndex
    {
        $row = ThreadIndex::query()->where('uid', $uid)->first();
        if ($row === null || $row->author !== $username || $row->subject_type !== $subject->type || ! $subject->isSameSubject($row->subject_key)) {
            return null;
        }

        return $row;
    }

    /**
     * @return array{entry: array<string, mixed>, created: bool}
     */
    private function replay(ThreadSubject $subject, ThreadIndex $row): array
    {
        if ($row->subject_key !== $subject->key()) {
            throw new ApiHttpException(409, 'This comment was already stored in an earlier place.', 'already_stored');
        }

        return ['entry' => $this->presenter->presentOne($row), 'created' => false];
    }

    private function assertCanPost(ThreadSubject $subject): void
    {
        if (! $subject->canPost) {
            throw new ApiHttpException(403, 'You can read this thread but not write to it.', 'forbidden');
        }
    }

    private function requireParent(CalendarInstance $pool, ThreadSubject $subject, mixed $parentId): ?string
    {
        if (! is_string($parentId) || $parentId === '') {
            return null;
        }
        $parentUid = ThreadEntryJournal::normalizeUlid($parentId, 'Parent');
        $isRoot = $this->threadRows($pool, $subject)
            ->where('uid', $parentUid)
            ->where('kind', ThreadIndex::KIND_COMMENT)
            ->exists();
        if (! $isRoot) {
            throw new ApiHttpException(422, 'parentId must be a comment in this thread.', 'invalidProperties', ['parentId']);
        }

        return $parentUid;
    }

    /**
     * @return array{0: CalendarInstance, 1: ThreadIndex}
     */
    private function requireEntry(ThreadSubject $subject, string $entryId): array
    {
        $uid = strtoupper(trim($entryId));
        $pool = $this->pools->find($subject->type, $subject->poolOwner);
        $row = $pool === null ? null : $this->threadRows($pool, $subject)->where('uid', $uid)->first();
        if ($pool === null || $row === null) {
            throw new ApiHttpException(404, 'Entry not found.', 'not_found');
        }

        return [$pool, $row];
    }

    /**
     * Edit and delete: write access, an entry under the current key, not an
     * activity entry, and the caller's own.
     *
     * @return array{0: CalendarInstance, 1: ThreadIndex}
     */
    private function requireOwnWritable(ThreadSubject $subject, string $username, string $entryId): array
    {
        $this->assertCanPost($subject);
        [$pool, $row] = $this->requireEntry($subject, $entryId);
        if ($row->kind === ThreadIndex::KIND_ACTIVITY) {
            throw new ApiHttpException(409, 'Activity entries cannot be changed.', 'conflict');
        }
        if ($row->author !== $username) {
            throw new ApiHttpException(403, 'Only the author can change this entry.', 'forbidden');
        }

        return [$pool, $row];
    }

    /**
     * Mentions of people in the audience, named by the server: a client
     * displayName is ignored ({@see ThreadMentions}).
     *
     * @param  list<array{id: string, displayName?: string}>  $mentions
     * @return list<array{id: string, displayName: string}>
     */
    private function mentionsInAudience(ThreadSubjectType $type, ThreadSubject $subject, array $mentions): array
    {
        if ($mentions === []) {
            return [];
        }
        $audience = array_fill_keys(array_map('strtolower', $type->audience($subject)), true);

        return array_values(array_filter(
            ThreadMentions::resolve($mentions),
            static fn (array $mention): bool => isset($audience[$mention['id']]),
        ));
    }

    private static function encodeCursor(string $createdAt, string $uid): string
    {
        return rtrim(strtr(base64_encode($createdAt.'|'.$uid), '+/', '-_'), '=');
    }

    /**
     * @return array{0: string, 1: string}
     */
    private static function decodeCursor(string $cursor): array
    {
        $decoded = base64_decode(strtr($cursor, '-_', '+/'), true);
        $parts = is_string($decoded) ? explode('|', $decoded) : [];
        if (count($parts) !== 2 || preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/', $parts[0]) !== 1 || $parts[1] === '') {
            throw new ApiHttpException(400, 'cursor is invalid.', 'invalidArguments', ['cursor']);
        }

        return [$parts[0], $parts[1]];
    }
}
