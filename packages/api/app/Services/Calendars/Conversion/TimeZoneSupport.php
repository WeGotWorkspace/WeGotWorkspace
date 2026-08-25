<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VTimeZone;
use Sabre\VObject\Reader;

/**
 * VTIMEZONE ↔ JMAP timeZones map on CalendarEvent.
 */
final class TimeZoneSupport
{
    /**
     * @return array<string, array<string, mixed>>
     */
    public static function timeZonesFromCalendar(VCalendar $calendar, ?string $eventTimeZone = null): array
    {
        $zones = [];
        foreach ($calendar->select('VTIMEZONE') as $component) {
            if (! $component instanceof VTimeZone) {
                continue;
            }
            $tzid = isset($component->TZID) ? trim((string) $component->TZID->getValue()) : '';
            if ($tzid === '') {
                continue;
            }
            $zones[$tzid] = [
                '@type' => 'TimeZone',
                'tzid' => $tzid,
                'icsDefinition' => $component->serialize(),
            ];
        }

        if ($eventTimeZone !== null && $eventTimeZone !== '' && ! isset($zones[$eventTimeZone])) {
            $zones[$eventTimeZone] = [
                '@type' => 'TimeZone',
                'tzid' => $eventTimeZone,
            ];
        }

        return $zones;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    public static function attachTimeZonesToEvent(VCalendar $calendar, array &$event): void
    {
        $eventTimeZone = isset($event['timeZone']) && is_string($event['timeZone']) ? $event['timeZone'] : null;
        $zones = self::timeZonesFromCalendar($calendar, $eventTimeZone);
        if ($zones !== []) {
            $event['timeZones'] = $zones;
        }
    }

    /**
     * Write a VTIMEZONE for every TZID referenced on the calendar.
     *
     * Prefers `timeZones[tzid].icsDefinition` when present; otherwise
     * synthesizes one from the IANA zone so outbound ICS stays RFC 5545 valid.
     *
     * @param  array<string, mixed>  $event
     */
    public static function writeTimeZonesToCalendar(VCalendar $calendar, array $event): void
    {
        foreach (self::referencedTimeZoneIdsInCalendar($calendar) as $tzid) {
            if (self::calendarHasTimeZone($calendar, $tzid)) {
                continue;
            }
            $definition = self::icsDefinitionFromEvent($event, $tzid);
            if ($definition !== null) {
                self::addDefinition($calendar, $definition);

                continue;
            }
            self::addGenerated($calendar, $tzid);
        }
    }

    /**
     * Repair a calendar that already has TZID params but no VTIMEZONE.
     */
    public static function ensureReferencedTimeZones(VCalendar $calendar): void
    {
        self::writeTimeZonesToCalendar($calendar, []);
    }

    /**
     * Collect TZIDs referenced on a VEVENT / VTODO for timezone preservation.
     *
     * @return list<string>
     */
    public static function referencedTimeZoneIds(Component $component): array
    {
        $ids = [];
        foreach (['DTSTART', 'DTEND', 'DUE', 'RECURRENCE-ID'] as $name) {
            if (isset($component->{$name}['TZID'])) {
                $tzid = trim((string) $component->{$name}['TZID']);
                if ($tzid !== '') {
                    $ids[] = $tzid;
                }
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * @return list<string>
     */
    public static function referencedTimeZoneIdsInCalendar(VCalendar $calendar): array
    {
        $ids = [];
        foreach (['VEVENT', 'VTODO'] as $name) {
            foreach ($calendar->select($name) as $component) {
                if (! $component instanceof Component) {
                    continue;
                }
                foreach (self::referencedTimeZoneIds($component) as $tzid) {
                    $ids[] = $tzid;
                }
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private static function icsDefinitionFromEvent(array $event, string $tzid): ?string
    {
        $timeZones = $event['timeZones'] ?? null;
        if (! is_array($timeZones)) {
            return null;
        }

        foreach ($timeZones as $key => $zone) {
            if (! is_array($zone)) {
                continue;
            }
            $zoneTzid = isset($zone['tzid']) && is_string($zone['tzid']) ? trim($zone['tzid']) : '';
            if ($zoneTzid === '' && is_string($key)) {
                $zoneTzid = trim($key);
            }
            if ($zoneTzid !== $tzid) {
                continue;
            }
            $definition = $zone['icsDefinition'] ?? null;
            if (is_string($definition) && str_contains($definition, 'BEGIN:VTIMEZONE')) {
                return $definition;
            }
        }

        return null;
    }

    private static function calendarHasTimeZone(VCalendar $calendar, string $tzid): bool
    {
        foreach ($calendar->select('VTIMEZONE') as $component) {
            if (! $component instanceof VTimeZone) {
                continue;
            }
            $existing = isset($component->TZID) ? trim((string) $component->TZID->getValue()) : '';
            if ($existing === $tzid) {
                return true;
            }
        }

        return false;
    }

    private static function addGenerated(VCalendar $calendar, string $tzid): void
    {
        $definition = IanaVTimeZoneFactory::icsDefinition($tzid);
        if ($definition === null) {
            return;
        }
        self::addDefinition($calendar, $definition);
    }

    private static function addDefinition(VCalendar $calendar, string $definition): void
    {
        if (! str_contains($definition, 'BEGIN:VTIMEZONE')) {
            return;
        }

        $ics = str_contains($definition, 'BEGIN:VCALENDAR')
            ? $definition
            : "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{$definition}\r\nEND:VCALENDAR";

        $parsed = Reader::read($ics);
        if (! $parsed instanceof VCalendar) {
            return;
        }
        foreach ($parsed->select('VTIMEZONE') as $component) {
            if (! $component instanceof VTimeZone) {
                continue;
            }
            $tzid = isset($component->TZID) ? trim((string) $component->TZID->getValue()) : '';
            if ($tzid !== '' && self::calendarHasTimeZone($calendar, $tzid)) {
                return;
            }
            $calendar->add($component);

            return;
        }
    }
}
