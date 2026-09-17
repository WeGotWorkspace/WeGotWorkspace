<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\Calendar;
use App\Models\CalendarChange;
use App\Models\CalendarObject;
use Illuminate\Support\Facades\DB;

/**
 * In-place notebook move: keep calendarobjects.id / uid / star FK and write
 * Sabre-equivalent dual changelog rows. Never a bare Eloquent calendarid save.
 */
final class NoteMoveHelper
{
    public const OP_ADD = 1;

    public const OP_DELETE = 3;

    public function move(CalendarObject $object, int $destinationCalendarId): void
    {
        $sourceCalendarId = (int) $object->calendarid;
        if ($sourceCalendarId === $destinationCalendarId) {
            return;
        }

        $uri = (string) $object->uri;

        DB::connection('wgw')->transaction(function () use ($object, $sourceCalendarId, $destinationCalendarId, $uri): void {
            $this->recordChange($sourceCalendarId, $uri, self::OP_DELETE);
            $this->recordChange($destinationCalendarId, $uri, self::OP_ADD);
            $object->calendarid = $destinationCalendarId;
            $object->save();
        });
    }

    private function recordChange(int $calendarId, string $uri, int $operation): void
    {
        $synctoken = (int) Calendar::query()->whereKey($calendarId)->value('synctoken');
        CalendarChange::query()->create([
            'uri' => $uri,
            'synctoken' => $synctoken,
            'calendarid' => $calendarId,
            'operation' => $operation,
        ]);
        Calendar::query()->whereKey($calendarId)->update(['synctoken' => $synctoken + 1]);
    }
}
