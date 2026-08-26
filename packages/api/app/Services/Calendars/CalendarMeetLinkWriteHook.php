<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Services\Meet\MeetReservationService;
use Illuminate\Support\Facades\Log;

/**
 * Shared ICS persist hook: inbound same-origin WGW reserve + finite expiresAt recompute.
 * Invoked from JMAP persistEventMutation/create and CalDAV PUT (not CalendarEventSetService alone).
 */
final class CalendarMeetLinkWriteHook
{
    public function __construct(
        private readonly MeetReservationService $reservations,
        private readonly CalendarMeetLinkIcsAnalysis $analysis = new CalendarMeetLinkIcsAnalysis,
    ) {}

    public function afterPersist(
        string $newIcs,
        ?string $oldIcs,
        string $ownerPrincipal,
        string $createdBy,
    ): void {
        try {
            $this->apply($newIcs, $oldIcs, $ownerPrincipal, $createdBy);
        } catch (\Throwable $e) {
            Log::warning('calendar_meet_link_hook_failed', [
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function apply(
        string $newIcs,
        ?string $oldIcs,
        string $ownerPrincipal,
        string $createdBy,
    ): void {
        $newRooms = $this->analysis->rooms($newIcs);
        $oldByCode = [];
        if ($oldIcs !== null && trim($oldIcs) !== '') {
            foreach ($this->analysis->rooms($oldIcs) as $room) {
                $oldByCode[$room['code']] = $room;
            }
        }

        foreach ($newRooms as $room) {
            $this->reservations->reserve(
                $room['code'],
                $ownerPrincipal,
                $createdBy,
                $room['expiresAt'],
            );

            $previous = $oldByCode[$room['code']] ?? null;
            if ($previous === null) {
                continue;
            }
            if ($room['scope'] === 'series') {
                continue;
            }
            if ($previous['end'] === $room['end']) {
                continue;
            }
            $this->reservations->patchExpiresAt($room['code'], $room['expiresAt']);
        }
    }
}
