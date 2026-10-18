<?php

declare(strict_types=1);

namespace App\Services\VObject;

use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Property;
use Sabre\VObject\Reader;

/**
 * Applies a WGW edit to the stored iCalendar without rebuilding it.
 *
 * The writers can only produce what the JMAP model holds. Rebuilding the stored
 * object from that model drops everything else a client wrote (#1392). Instead,
 * the writer renders twice: `baseline` from the event as it was read, and
 * `generated` from the edited event. Per component (UID + RECURRENCE-ID) and per
 * property name, a group whose baseline and generated renderings are equal was
 * not touched by the edit, so the stored lines stay byte-identical. Only changed
 * groups take the generated lines. Calendar-level properties, VTIMEZONEs, unknown
 * properties and unknown sub-components are kept as stored.
 */
final class ICalendarInPlacePatcher
{
    private const PATCHED_COMPONENTS = ['VEVENT', 'VTODO', 'VJOURNAL'];

    public static function patch(string $stored, string $baseline, string $generated): string
    {
        $storedDoc = Reader::read($stored);
        $baselineDoc = Reader::read($baseline);
        $generatedDoc = Reader::read($generated);
        if (! $storedDoc instanceof VCalendar || ! $baselineDoc instanceof VCalendar || ! $generatedDoc instanceof VCalendar) {
            return $generated;
        }

        $storedItems = self::itemsByKey($storedDoc);
        $baselineItems = self::itemsByKey($baselineDoc);
        $generatedItems = self::itemsByKey($generatedDoc);

        foreach ($storedItems as $key => $storedItem) {
            if (! isset($generatedItems[$key]) && isset($baselineItems[$key])) {
                $storedDoc->remove($storedItem);
            }
        }

        foreach ($generatedItems as $key => $generatedItem) {
            $storedItem = $storedItems[$key] ?? null;
            $baselineItem = $baselineItems[$key] ?? null;
            if ($storedItem === null || $baselineItem === null) {
                $storedDoc->add(clone $generatedItem);

                continue;
            }
            self::patchComponent($storedItem, $baselineItem, $generatedItem);
        }

        self::addMissingTimeZones($storedDoc, $generatedDoc);

        return $storedDoc->serialize();
    }

    private static function patchComponent(Component $stored, Component $baseline, Component $generated): void
    {
        $names = array_unique(array_merge(self::propertyNames($baseline), self::propertyNames($generated)));
        foreach ($names as $name) {
            $baselineLines = self::propertyLines($baseline, $name);
            $generatedLines = self::propertyLines($generated, $name);
            if ($baselineLines === $generatedLines) {
                continue;
            }
            foreach ($stored->select($name) as $property) {
                if ($property instanceof Property) {
                    $stored->remove($property);
                }
            }
            foreach ($generated->select($name) as $property) {
                if ($property instanceof Property) {
                    $stored->add(clone $property);
                }
            }
        }

        self::patchAlarms($stored, $baseline, $generated);
    }

    /**
     * Alarms are matched by position against the baseline. An alarm whose
     * rendering did not change keeps its stored form (UID, ACKNOWLEDGED, snooze
     * and vendor properties). A changed alarm takes the generated form but keeps
     * the stored UID so clients see an edit, not a new alarm.
     */
    private static function patchAlarms(Component $stored, Component $baseline, Component $generated): void
    {
        $storedAlarms = self::alarms($stored);
        $baselineAlarms = self::alarms($baseline);
        $generatedAlarms = self::alarms($generated);

        $baselineRendered = array_map(self::renderComponent(...), $baselineAlarms);
        $generatedRendered = array_map(self::renderComponent(...), $generatedAlarms);
        if ($baselineRendered === $generatedRendered) {
            return;
        }

        $aligned = count($storedAlarms) === count($baselineAlarms);
        $usedStored = [];
        $result = [];
        foreach ($generatedAlarms as $index => $generatedAlarm) {
            $match = $aligned ? array_search($generatedRendered[$index], $baselineRendered, true) : false;
            if (is_int($match) && ! isset($usedStored[$match])) {
                $usedStored[$match] = true;
                $result[] = $storedAlarms[$match];

                continue;
            }
            $copy = clone $generatedAlarm;
            if ($aligned && isset($storedAlarms[$index]) && ! isset($usedStored[$index])) {
                foreach (['UID', 'X-WR-ALARMUID'] as $idName) {
                    if (! isset($copy->{$idName}) && isset($storedAlarms[$index]->{$idName})) {
                        $copy->add(clone $storedAlarms[$index]->{$idName});
                    }
                }
            }
            $result[] = $copy;
        }

        foreach ($storedAlarms as $alarm) {
            $stored->remove($alarm);
        }
        foreach ($result as $alarm) {
            $stored->add($alarm);
        }
    }

    private static function addMissingTimeZones(VCalendar $stored, VCalendar $generated): void
    {
        $present = [];
        foreach ($stored->select('VTIMEZONE') as $zone) {
            if ($zone instanceof Component && isset($zone->TZID)) {
                $present[(string) $zone->TZID] = true;
            }
        }
        foreach ($generated->select('VTIMEZONE') as $zone) {
            if ($zone instanceof Component && isset($zone->TZID) && ! isset($present[(string) $zone->TZID])) {
                $stored->add(clone $zone);
            }
        }
    }

    /**
     * @return array<string, Component>
     */
    private static function itemsByKey(VCalendar $calendar): array
    {
        $items = [];
        foreach ($calendar->children() as $child) {
            if (! $child instanceof Component || ! in_array($child->name, self::PATCHED_COMPONENTS, true)) {
                continue;
            }
            $uid = isset($child->UID) ? trim((string) $child->UID) : '';
            $recurrenceId = isset($child->{'RECURRENCE-ID'}) ? self::normalizedRecurrenceId($child->{'RECURRENCE-ID'}) : '';
            $items[$child->name.'|'.$uid.'|'.$recurrenceId] = $child;
        }

        return $items;
    }

    private static function normalizedRecurrenceId(mixed $property): string
    {
        // A date-only value matches whether or not the writer set VALUE=DATE.
        $raw = $property instanceof Property ? trim((string) $property->getValue()) : '';
        if (preg_match('/^\d{8}$/', $raw) === 1) {
            return $raw;
        }
        if ($property instanceof Property\ICalendar\DateTime) {
            try {
                return $property->hasTime()
                    ? $property->getDateTime()->setTimezone(new \DateTimeZone('UTC'))->format('Ymd\THis\Z')
                    : $property->getDateTime()->format('Ymd');
            } catch (\Throwable) {
                // Fall through to the raw value.
            }
        }

        return $property instanceof Property ? (string) $property->getValue() : '';
    }

    /**
     * @return list<string>
     */
    private static function propertyNames(Component $component): array
    {
        $names = [];
        foreach ($component->children() as $child) {
            if ($child instanceof Property) {
                $names[$child->name] = true;
            }
        }

        return array_keys($names);
    }

    /**
     * @return list<string>
     */
    private static function propertyLines(Component $component, string $name): array
    {
        $lines = [];
        foreach ($component->select($name) as $property) {
            if ($property instanceof Property) {
                $lines[] = $property->serialize();
            }
        }
        sort($lines);

        return $lines;
    }

    /**
     * @return list<Component>
     */
    private static function alarms(Component $component): array
    {
        $alarms = [];
        foreach ($component->select('VALARM') as $alarm) {
            if ($alarm instanceof Component) {
                $alarms[] = $alarm;
            }
        }

        return $alarms;
    }

    private static function renderComponent(Component $component): string
    {
        $lines = [];
        foreach ($component->children() as $child) {
            $lines[] = $child->serialize();
        }
        sort($lines);

        return implode('', $lines);
    }
}
