<?php

declare(strict_types=1);

namespace App\Services\Threads;

use App\Models\CalendarInstance;
use App\Models\ThreadIndex;

/**
 * The API shape of a shared thread entry (#2173, spec.md "Thread API"):
 * id, kind, parentId, author {username, displayName}, body (null for activity
 * and tombstones), mentions, reactions, createdAt, editedAt, deletedAt and
 * activity. Author names are looked up once per call, with current names.
 */
final class ThreadEntryPresenter
{
    public function __construct(private readonly ThreadEntryStore $store) {}

    /**
     * @param  list<ThreadIndex>  $rows
     * @return list<array<string, mixed>>
     */
    public function present(CalendarInstance $pool, array $rows): array
    {
        $raw = $this->store->rawByUid((int) $pool->calendarid, array_map(static fn (ThreadIndex $row): string => $row->uid, $rows));
        $names = ThreadAuthorNames::lookup(array_values(array_unique(array_map(static fn (ThreadIndex $row): string => $row->author, $rows))));
        $entries = [];
        foreach ($rows as $row) {
            if (isset($raw[$row->uid])) {
                $entries[] = $this->entry($row, $raw[$row->uid], $names);
            }
        }

        return $entries;
    }

    /** @return array<string, mixed> */
    public function presentOne(CalendarInstance $pool, ThreadIndex $row): array
    {
        return $this->present($pool, [$row])[0]
            ?? throw new \LogicException('Thread entry '.$row->uid.' has no stored object.');
    }

    /**
     * @param  array<string, string>  $names
     * @return array<string, mixed>
     */
    private function entry(ThreadIndex $row, string $ics, array $names): array
    {
        $journal = $this->store->journal();
        [, $vjournal] = $journal->read($ics);
        $base = $journal->baseFields($vjournal, $row->uid);
        $tombstoned = $journal->isTombstoned($vjournal);
        $activity = null;
        if ($row->kind === ThreadIndex::KIND_ACTIVITY && isset($vjournal->{'X-WGW-ACTIVITY'})) {
            $decoded = json_decode((string) $vjournal->{'X-WGW-ACTIVITY'}, true);
            $activity = is_array($decoded) ? $decoded : null;
        }
        $deletedAt = isset($vjournal->{'X-WGW-DELETED-AT'}) ? (string) $vjournal->{'X-WGW-DELETED-AT'} : null;

        return [
            'id' => $row->uid,
            'kind' => $row->kind,
            'parentId' => $row->parent_uid,
            'author' => [
                'username' => $row->author,
                'displayName' => $names[$row->author] ?? $row->author,
            ],
            'body' => ($tombstoned || $row->kind === ThreadIndex::KIND_ACTIVITY) ? null : $base['body'],
            'mentions' => $tombstoned ? [] : $journal->mentionsOf($vjournal),
            'reactions' => $journal->reactionsOf($vjournal),
            'createdAt' => $base['createdAt'],
            'editedAt' => $journal->dateTimeValue($vjournal, 'LAST-MODIFIED'),
            'deletedAt' => $deletedAt !== '' ? $deletedAt : null,
            'activity' => $activity,
        ];
    }
}
