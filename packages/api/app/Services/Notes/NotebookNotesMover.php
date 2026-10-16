<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use Illuminate\Support\Facades\DB;

/** Move every VJOURNAL from one notebook collection to another inside one transaction. */
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

        return DB::connection('wgw')->transaction(function () use ($sourceCalendarId, $destinationCalendarId): int {
            $objects = CalendarObject::query()
                ->where('calendarid', $sourceCalendarId)
                ->where('componenttype', 'VJOURNAL')
                ->lockForUpdate()
                ->get();
            foreach ($objects as $object) {
                $this->moveHelper->assertUidAvailable((string) $object->uid, $sourceCalendarId);
            }
            foreach ($objects as $object) {
                $this->moveHelper->move($object, $destinationCalendarId);
            }

            return $objects->count();
        });
    }
}
