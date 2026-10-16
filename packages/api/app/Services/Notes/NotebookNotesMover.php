<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;

/** Move every VJOURNAL onto the destination. The caller already holds the transaction. */
final class NotebookNotesMover
{
    public function __construct(private readonly NoteMoveHelper $moveHelper) {}

    public function moveAll(CalendarInstance $source, CalendarInstance $destination): int
    {
        $sourceCalendarId = (int) $source->calendarid;
        $destinationCalendarId = (int) $destination->calendarid;
        if ($sourceCalendarId === $destinationCalendarId) {
            return 0;
        }

        $objects = CalendarObject::query()
            ->where('calendarid', $sourceCalendarId)
            ->where('componenttype', 'VJOURNAL')
            ->lockForUpdate()
            ->get();
        foreach ($objects as $object) {
            $this->moveHelper->assertUidAvailable((string) $object->uid, $sourceCalendarId);
        }
        if ($objects->isEmpty()) {
            return 0;
        }

        $destinationToken = (int) Calendar::query()->whereKey($destinationCalendarId)->value('synctoken');
        foreach ($objects as $object) {
            $this->moveHelper->moveWithoutTokenBump($object, $destinationCalendarId, $destinationToken);
        }
        $this->moveHelper->bumpSyncToken($destinationCalendarId);

        return $objects->count();
    }
}
