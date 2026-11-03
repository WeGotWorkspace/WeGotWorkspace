<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\Calendar;
use App\Models\CalendarChange;
use App\Models\CalendarObject;
use App\Services\VObject\VJournalUidGuard;
use Illuminate\Support\Facades\DB;

/**
 * In-place notebook move: keep calendarobjects.id / uid / star FK and write
 * Sabre-equivalent dual changelog rows. Never a bare Eloquent calendarid save.
 */
final class NoteMoveHelper
{
    public const OP_ADD = 1;

    public const OP_DELETE = 3;

    public const UID_CONFLICT = 'A note with this UID already exists.';

    public function __construct(private readonly VJournalUidGuard $uidGuard) {}

    /**
     * UID is the collab room key. Uniqueness is global across VJOURNAL objects.
     * When $exceptCalendarId is set (a move), the source calendar is ignored.
     */
    public function assertUidAvailable(string $uid, ?int $exceptCalendarId = null): void
    {
        $this->uidGuard->assertAvailable($uid, self::UID_CONFLICT, $exceptCalendarId);
    }

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

    /**
     * Write the destination ADD for a bulk move without advancing the synctoken.
     * The source notebook is deleted in the same transaction, so no source row is written.
     * The caller bumps the destination once after every note has moved.
     */
    public function moveWithoutTokenBump(
        CalendarObject $object,
        int $destinationCalendarId,
        int $destinationSyncToken,
    ): void {
        $sourceCalendarId = (int) $object->calendarid;
        if ($sourceCalendarId === $destinationCalendarId) {
            return;
        }

        $this->writeChange($destinationCalendarId, (string) $object->uri, self::OP_ADD, $destinationSyncToken);
        $object->calendarid = $destinationCalendarId;
        $object->save();
    }

    public function bumpSyncToken(int $calendarId): void
    {
        $synctoken = (int) Calendar::query()->whereKey($calendarId)->value('synctoken');
        Calendar::query()->whereKey($calendarId)->update(['synctoken' => $synctoken + 1]);
    }

    private function recordChange(int $calendarId, string $uri, int $operation): void
    {
        $synctoken = (int) Calendar::query()->whereKey($calendarId)->value('synctoken');
        $this->writeChange($calendarId, $uri, $operation, $synctoken);
        Calendar::query()->whereKey($calendarId)->update(['synctoken' => $synctoken + 1]);
    }

    private function writeChange(int $calendarId, string $uri, int $operation, int $synctoken): void
    {
        CalendarChange::query()->create([
            'uri' => $uri,
            'synctoken' => $synctoken,
            'calendarid' => $calendarId,
            'operation' => $operation,
        ]);
    }
}
