<?php

declare(strict_types=1);

namespace Tests\Support;

use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VTimeZone;
use Sabre\VObject\Reader;

/**
 * RFC 5545: every TZID parameter on a DATE-TIME must have a VTIMEZONE.
 */
trait AssertsIcsTimeZones
{
    /**
     * @return list<string>
     */
    protected function tzidsReferencedInIcs(string $ics): array
    {
        preg_match_all('/(?:^|;)TZID=([^:;,\r\n]+)/m', $ics, $matches);

        $ids = [];
        foreach ($matches[1] as $tzid) {
            $tzid = trim((string) $tzid);
            if ($tzid !== '') {
                $ids[] = $tzid;
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * @return list<string>
     */
    protected function tzidsDefinedInIcs(string $ics): array
    {
        $calendar = Reader::read($ics);
        $this->assertInstanceOf(VCalendar::class, $calendar);

        $ids = [];
        foreach ($calendar->select('VTIMEZONE') as $component) {
            if (! $component instanceof VTimeZone) {
                continue;
            }
            $tzid = isset($component->TZID) ? trim((string) $component->TZID->getValue()) : '';
            if ($tzid !== '') {
                $ids[] = $tzid;
            }
        }

        return array_values(array_unique($ids));
    }

    protected function assertEveryTzidHasVTimeZone(string $ics, string $message = ''): void
    {
        $referenced = $this->tzidsReferencedInIcs($ics);
        if ($referenced === []) {
            $this->assertStringNotContainsString(
                'BEGIN:VTIMEZONE',
                $ics,
                $message !== '' ? $message : 'UTC/floating ICS must not invent a VTIMEZONE',
            );

            return;
        }

        $defined = $this->tzidsDefinedInIcs($ics);
        foreach ($referenced as $tzid) {
            $this->assertContains(
                $tzid,
                $defined,
                ($message !== '' ? $message.' — ' : '')."TZID={$tzid} must have a matching VTIMEZONE",
            );
        }
    }
}
