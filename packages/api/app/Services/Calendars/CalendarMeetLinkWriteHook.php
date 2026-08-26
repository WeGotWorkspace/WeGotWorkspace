<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Services\Meet\MeetReservationService;
use Illuminate\Support\Facades\Log;

/**
 * Shared ICS persist hook: inbound same-origin WGW reserve + finite expiresAt recompute.
 * Invoked from JMAP persistEventMutation/create and CalDAV PUT (not CalendarEventSetService alone).
 *
 * `reserve()` always writes the event/scope clock (`expiresAt` from ICS analysis):
 * series / this-and-future → null while attached; single / this-instance → end + grace.
 */
final class CalendarMeetLinkWriteHook
{
    public const RESERVE_FAILED_LOG = 'calendar_meet_link_reserve_failed';

    public function __construct(
        private readonly MeetReservationService $reservations,
        private readonly CalendarMeetLinkIcsAnalysis $analysis = new CalendarMeetLinkIcsAnalysis,
    ) {}

    /**
     * @param  string|null  $oldIcs  Unused. Callers still pass the previous document;
     *                               expiry now comes only from the new ICS via reserve().
     */
    public function afterPersist(
        string $newIcs,
        ?string $oldIcs,
        string $ownerPrincipal,
        string $createdBy,
    ): void {
        try {
            $this->apply($newIcs, $ownerPrincipal, $createdBy);
        } catch (\Throwable $e) {
            Log::warning(self::RESERVE_FAILED_LOG, [
                'room_ids' => $this->roomIds($newIcs),
                'event_uid' => $this->analysis->primaryUid($newIcs),
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);
        }
    }

    private function apply(
        string $newIcs,
        string $ownerPrincipal,
        string $createdBy,
    ): void {
        foreach ($this->analysis->rooms($newIcs) as $room) {
            $this->reservations->reserve(
                $room['code'],
                $ownerPrincipal,
                $createdBy,
                $room['expiresAt'],
            );
        }
    }

    /**
     * @return list<string>
     */
    private function roomIds(string $ics): array
    {
        try {
            return array_values(array_unique(array_column($this->analysis->rooms($ics), 'code')));
        } catch (\Throwable) {
            return [];
        }
    }
}
