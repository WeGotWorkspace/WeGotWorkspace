<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability\PublicLink;

use App\Services\Calendars\Availability\AvailabilityResult;
use Sabre\VObject\Component\VCalendar;

/**
 * Turns busy periods into the public feed: one VCALENDAR of plain "Busy"
 * VEVENTs. The output is built from start and end alone. Periods are clipped
 * to the window, empty ones dropped and overlapping or touching ones merged,
 * so a reader cannot count events or see their edges. UIDs are keyed hashes of
 * the merged block under the link's secret: no event UID leaves the server and
 * a new link changes every UID.
 */
final class AvailabilityPublicFeedBuilder
{
    /**
     * @param  int  $windowStart  Unix seconds, Monday 00:00 UTC
     * @param  int  $windowEnd  Unix seconds, exclusive
     */
    public function build(AvailabilityResult $result, int $windowStart, int $windowEnd, string $uidKey, int $stamp, string $calendarName = 'Availability'): string
    {
        $out = new VCalendar;
        $out->PRODID = '-//WeGotWorkspace//Availability//EN';
        $out->add('X-WR-CALNAME', $calendarName);
        $out->add('NAME', $calendarName);
        $out->add('REFRESH-INTERVAL', 'PT1H', ['VALUE' => 'DURATION']);
        $out->add('X-PUBLISHED-TTL', 'PT1H');

        foreach (self::merge($result, $windowStart, $windowEnd) as [$start, $end]) {
            $out->add('VEVENT', [
                'UID' => substr(hash_hmac('sha256', $start.'-'.$end, $uidKey), 0, 32).'@availability',
                'DTSTAMP' => new \DateTimeImmutable('@'.$stamp),
                'DTSTART' => new \DateTimeImmutable('@'.$start),
                'DTEND' => new \DateTimeImmutable('@'.$end),
                'SUMMARY' => 'Busy',
                'TRANSP' => 'OPAQUE',
                'CLASS' => 'PUBLIC',
            ]);
        }

        return $out->serialize();
    }

    /**
     * @return list<array{0: int, 1: int}> sorted, disjoint [start, end) in Unix seconds
     */
    public static function merge(AvailabilityResult $result, int $windowStart, int $windowEnd): array
    {
        $blocks = [];
        foreach ($result->entries as $entry) {
            $start = max($entry['utcStart'], $windowStart);
            $end = min($entry['utcEnd'], $windowEnd);
            if ($end <= $start) {
                continue;
            }
            $last = count($blocks) - 1;
            if ($last >= 0 && $start <= $blocks[$last][1]) {
                $blocks[$last][1] = max($blocks[$last][1], $end);

                continue;
            }
            $blocks[] = [$start, $end];
        }

        return $blocks;
    }
}
