<?php

declare(strict_types=1);

namespace App\Services\Threads;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\ThreadIndex;
use App\Services\Calendars\CalDavCollections;
use App\Services\VObject\VJournalUidGuard;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDOException;

/**
 * Storage of shared thread entries (#2173): one VJOURNAL per entry in the
 * owner's pool, plus its `thread_index` row. Every write goes through the
 * Sabre backend, so it lands in `calendarchanges`, and stamps the row's
 * `modseq` with the pool's sync token after the write.
 *
 * On top of the shared core ({@see ThreadEntryJournal}) an entry carries
 * `X-WGW-SUBJECT-TYPE`, `X-WGW-SUBJECT-KEY`, `X-WGW-SUBJECT-SCOPE`,
 * `X-WGW-KIND` and, for activity, `X-WGW-ACTIVITY`.
 */
final class ThreadEntryStore
{
    public const UID_CONFLICT = 'An entry with this id already exists.';

    private readonly ThreadEntryJournal $journal;

    public function __construct(
        private readonly WgwCalendarBackendFactory $backends,
        private readonly CalDavCollections $collections,
        private readonly VJournalUidGuard $uidGuard,
    ) {
        $this->journal = new ThreadEntryJournal('Entry');
    }

    public function journal(): ThreadEntryJournal
    {
        return $this->journal;
    }

    /** True when no entry, note, Docs thread or chat message uses this UID. */
    public function uidIsFree(string $uid): bool
    {
        return ! ThreadIndex::query()->where('uid', $uid)->exists()
            && ! CalendarObject::query()->where('uid', $uid)->where('componenttype', 'VJOURNAL')->exists();
    }

    public static function freshUid(): string
    {
        return strtoupper((string) Str::ulid());
    }

    /**
     * Insert one entry. $replay runs inside the transaction before the insert
     * and may return an existing row instead (an idempotent retry); after a
     * unique violation from a concurrent insert of the same UID it runs again.
     *
     * @param  array{body: string, author: string, kind: string, parentUid: string|null, mentions: list<array{id: string, displayName?: string}>, activity: array<string, mixed>|null}  $entry
     * @param  \Closure(): ?ThreadIndex  $replay
     * @return array{row: ThreadIndex, created: bool}
     */
    public function insert(CalendarInstance $pool, ThreadSubject $subject, string $uid, array $entry, \Closure $replay): array
    {
        $calendarId = (int) $pool->calendarid;
        try {
            return DB::connection('wgw')->transaction(function () use ($pool, $subject, $uid, $entry, $replay, $calendarId): array {
                $existing = $replay();
                if ($existing !== null) {
                    return ['row' => $existing, 'created' => false];
                }
                $this->uidGuard->assertAvailable($uid, self::UID_CONFLICT);
                $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
                $this->backends->calBackend()->createCalendarObject(
                    $this->collections->backendId($pool),
                    $uid.'.ics',
                    $this->toIcs($subject, $uid, $now, $entry),
                );
                $field = $entry['activity']['field'] ?? null;
                $row = ThreadIndex::query()->create([
                    'uid' => $uid,
                    'pool_calendarid' => $calendarId,
                    'subject_type' => $subject->type,
                    'subject_key' => $subject->key(),
                    'subject_scope' => $subject->scope,
                    'kind' => $entry['kind'],
                    'parent_uid' => $entry['parentUid'],
                    'author' => $entry['author'],
                    'created_at' => $now->format('Y-m-d H:i:s.u'),
                    'modseq' => $this->syncToken($calendarId),
                    'activity_field' => is_string($field) ? substr($field, 0, 64) : null,
                ]);

                return ['row' => $row, 'created' => true];
            }, 3);
        } catch (QueryException|PDOException $exception) {
            $existing = $replay();
            if ($existing !== null) {
                return ['row' => $existing, 'created' => false];
            }
            VJournalUidGuard::throwIfUniqueViolation($exception, self::UID_CONFLICT);
            throw $exception;
        }
    }

    /**
     * Rewrite one entry's ICS under a row lock and bump its modseq. A rewrite
     * that changes nothing writes nothing.
     *
     * @param  \Closure(string): string  $rewrite  raw ICS in, raw ICS out
     */
    public function rewrite(CalendarInstance $pool, ThreadIndex $row, \Closure $rewrite): void
    {
        DB::connection('wgw')->transaction(function () use ($pool, $row, $rewrite): void {
            $object = CalendarObject::query()
                ->where('calendarid', (int) $pool->calendarid)
                ->where('uid', $row->uid)
                ->lockForUpdate()
                ->first();
            if ($object === null) {
                return;
            }
            $raw = self::rawIcs($object);
            $ics = $rewrite($raw);
            if ($ics === $raw) {
                return;
            }
            $this->backends->calBackend()->updateCalendarObject($this->collections->backendId($pool), (string) $object->uri, $ics);
            ThreadIndex::query()->whereKey($row->id)->update(['modseq' => $this->syncToken((int) $pool->calendarid)]);
        });
    }

    /**
     * Delete every entry the rows name, object and row together.
     *
     * @param  iterable<ThreadIndex>  $rows
     */
    public function deleteRows(CalendarInstance $pool, iterable $rows): void
    {
        DB::connection('wgw')->transaction(function () use ($pool, $rows): void {
            foreach ($rows as $row) {
                $uri = CalendarObject::query()
                    ->where('calendarid', (int) $pool->calendarid)
                    ->where('uid', $row->uid)
                    ->value('uri');
                if (is_string($uri) && $uri !== '') {
                    $this->backends->calBackend()->deleteCalendarObject($this->collections->backendId($pool), $uri);
                }
                ThreadIndex::query()->whereKey($row->id)->delete();
            }
        });
    }

    /**
     * Move entries into another pool, object and row together, keeping their
     * key and uri (an owner change of the scope, #2173). Each moved row gets
     * the new pool's sync token. A sync state names its pool, so one from the
     * old pool is answered by `ThreadRepository::changes` with
     * `cannotCalculateChanges`, however the two tokens compare.
     *
     * @param  iterable<ThreadIndex>  $rows  all in $from
     */
    public function moveRows(CalendarInstance $from, CalendarInstance $to, iterable $rows): void
    {
        DB::connection('wgw')->transaction(function () use ($from, $to, $rows): void {
            foreach ($rows as $row) {
                $object = CalendarObject::query()
                    ->where('calendarid', (int) $from->calendarid)
                    ->where('uid', $row->uid)
                    ->lockForUpdate()
                    ->first();
                if ($object !== null) {
                    $raw = self::rawIcs($object);
                    $uri = (string) $object->uri;
                    $this->backends->calBackend()->deleteCalendarObject($this->collections->backendId($from), $uri);
                    $this->backends->calBackend()->createCalendarObject($this->collections->backendId($to), $uri, $raw);
                }
                ThreadIndex::query()->whereKey($row->id)->update([
                    'pool_calendarid' => (int) $to->calendarid,
                    'modseq' => $this->syncToken((int) $to->calendarid),
                ]);
            }
        });
    }

    /**
     * Stored ICS per row, read from each row's own pool.
     *
     * @param  list<ThreadIndex>  $rows
     * @return array<string, string> uid => ICS
     */
    public function rawForRows(array $rows): array
    {
        $byPool = [];
        foreach ($rows as $row) {
            $byPool[(int) $row->pool_calendarid][] = $row->uid;
        }
        $raw = [];
        foreach ($byPool as $calendarId => $uids) {
            $raw += $this->rawByUid($calendarId, $uids);
        }

        return $raw;
    }

    /**
     * Stored ICS per UID, in one query.
     *
     * @param  list<string>  $uids
     * @return array<string, string>
     */
    public function rawByUid(int $poolCalendarId, array $uids): array
    {
        if ($uids === []) {
            return [];
        }
        $raw = [];
        foreach (CalendarObject::query()->where('calendarid', $poolCalendarId)->whereIn('uid', $uids)->get(['uid', 'calendardata']) as $object) {
            $raw[(string) $object->uid] = self::rawIcs($object);
        }

        return $raw;
    }

    /**
     * @param  array{body: string, author: string, kind: string, parentUid: string|null, mentions: list<array{id: string, displayName?: string}>, activity: array<string, mixed>|null}  $entry
     */
    private function toIcs(ThreadSubject $subject, string $uid, DateTimeImmutable $now, array $entry): string
    {
        [$calendar, $journal] = $this->journal->create($uid, $now, $entry['body'], $entry['author']);
        if ($entry['kind'] === ThreadIndex::KIND_ACTIVITY) {
            unset($journal->DESCRIPTION);
        }
        $this->journal->addParent($journal, $entry['parentUid']);
        $this->journal->addMentions($journal, $entry['mentions']);
        $journal->add('X-WGW-SUBJECT-TYPE', $subject->type);
        $journal->add('X-WGW-SUBJECT-KEY', $subject->key());
        $journal->add('X-WGW-SUBJECT-SCOPE', $subject->scope);
        $journal->add('X-WGW-KIND', $entry['kind']);
        if ($entry['activity'] !== null) {
            $journal->add('X-WGW-ACTIVITY', json_encode($entry['activity'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        }

        return $calendar->serialize();
    }

    private function syncToken(int $calendarId): int
    {
        return (int) Calendar::query()->whereKey($calendarId)->value('synctoken');
    }

    private static function rawIcs(CalendarObject $object): string
    {
        return is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
    }
}
