<?php

declare(strict_types=1);

namespace App\Services\Threads;

use App\Models\CalendarInstance;
use App\Models\ThreadIndex;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * The one lifecycle call of the shared thread layer (#2173,
 * docs/architecture/threads.md rule 4): when a scope is deleted, its entries
 * of that subject type go with it. `thread_index` is shared by every subject
 * type, so one app's scope id never removes another app's entries.
 *
 * There is no time-based purge. A subject that is deleted or moved deletes
 * nothing; its entries stay hidden under the old key until the scope goes.
 */
final class ThreadLifecycle
{
    public function __construct(private readonly ThreadEntryStore $store) {}

    public function scopeDeleted(string $subjectType, string $scope): void
    {
        $byPool = [];
        foreach (ThreadIndex::query()
            ->where('subject_type', $subjectType)
            ->where('subject_scope', $scope)
            ->orderBy('id')
            ->get() as $row) {
            $byPool[$row->pool_calendarid][] = $row;
        }

        foreach ($byPool as $calendarId => $rows) {
            $pool = CalendarInstance::query()
                ->where('calendarid', $calendarId)
                ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
                ->orderBy('id')
                ->first();
            if ($pool === null) {
                ThreadIndex::query()->whereIn('id', array_map(static fn (ThreadIndex $row): int => (int) $row->id, $rows))->delete();

                continue;
            }
            $this->store->deleteRows($pool, $rows);
        }
    }
}
