<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use App\Services\VObject\ICalendarAlarmTrigger;
use Illuminate\Support\Str;
use Sabre\VObject\Component\VAlarm;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;

/**
 * Event-only helpers for iCalendar VEVENT ↔ JMAP CalendarEvent conversion.
 *
 * Shared DATE-TIME / RRULE / EXDATE / UID / VALARM TRIGGER live in
 * App\Services\VObject\. Multi-VEVENT ICS: CalDAV stores one .ics blob per
 * calendar object URI. When a resource contains multiple VEVENT components,
 * each maps to its own JMAP CalendarEvent with composite id
 * `{objectUri}#{veventUid}`. POST always writes a single-VEVENT object;
 * PUT/PATCH/DELETE on a composite id target one VEVENT.
 */
final class CalendarConversionSupport
{
    /**
     * @return list<VEvent>
     */
    public static function veventsFromCalendar(VCalendar $calendar): array
    {
        $events = [];
        foreach ($calendar->select('VEVENT') as $event) {
            if ($event instanceof VEvent) {
                $events[] = $event;
            }
        }

        return $events;
    }

    public static function primaryVEvent(VCalendar $calendar): ?VEvent
    {
        return self::veventsFromCalendar($calendar)[0] ?? null;
    }

    /**
     * RFC 8984 §1.4.6 duration from two JMAP local/UTC date-times (or all-day dates).
     * Used so DTEND-based CalDAV events also expose `duration`.
     *
     * The ABNF allows only weeks/days before T — never years or months, because
     * months have no fixed length. DateInterval's y/m/d split is therefore unused;
     * the span is total days plus leftover hours/minutes/seconds.
     */
    public static function durationBetweenJmapDateTimes(string $start, string $end): ?string
    {
        $start = trim($start);
        $end = trim($end);
        if ($start === '' || $end === '') {
            return null;
        }

        try {
            $startDt = new \DateTimeImmutable(self::dateTimeImmutableInput($start));
            $endDt = new \DateTimeImmutable(self::dateTimeImmutableInput($end));
        } catch (\Exception) {
            return null;
        }

        if ($endDt <= $startDt) {
            return null;
        }

        $interval = $startDt->diff($endDt);
        if ($interval->invert === 1 || ! is_int($interval->days) || $interval->days < 0) {
            return null;
        }

        $parts = 'P';
        if ($interval->days > 0) {
            $parts .= $interval->days.'D';
        }

        $hasTime = $interval->h > 0 || $interval->i > 0 || $interval->s > 0;
        if ($hasTime) {
            $parts .= 'T';
            if ($interval->h > 0) {
                $parts .= $interval->h.'H';
            }
            if ($interval->i > 0) {
                $parts .= $interval->i.'M';
            }
            if ($interval->s > 0) {
                $parts .= $interval->s.'S';
            }
        }

        return $parts === 'P' ? null : $parts;
    }

    private static function dateTimeImmutableInput(string $value): string
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1) {
            return $value.'T00:00:00';
        }

        if (str_ends_with($value, 'Z')) {
            return substr($value, 0, -1).'+00:00';
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>  $patch
     * @param  array<string, mixed>  $existing
     * @return array<string, mixed>
     */
    public static function deepMergeEventPatch(array $existing, array $patch): array
    {
        $merged = $existing;
        foreach ($patch as $key => $value) {
            if ($key === 'id' || $key === '@type') {
                continue;
            }
            if (is_array($value) && isset($merged[$key]) && is_array($merged[$key]) && self::isAssociativeMap($value) && self::isAssociativeMap($merged[$key])) {
                // recurrenceOverrides is a full replacement (RFC 8620 property set), not a
                // per-key merge — otherwise this-and-future splits cannot drop future exceptions.
                if ($key === 'recurrenceOverrides') {
                    $merged[$key] = $value;
                } else {
                    $merged[$key] = array_replace($merged[$key], $value);
                }
            } else {
                $merged[$key] = $value;
            }
        }

        return $merged;
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    public static function normalizeEventMapKeys(array $event, ?array $existing = null): array
    {
        unset($event['id']);

        if (! isset($event['@type']) || ! is_string($event['@type'])) {
            $event['@type'] = 'Event';
        }

        if (! isset($event['uid']) || ! is_string($event['uid']) || trim($event['uid']) === '') {
            $event['uid'] = 'urn:uuid:'.Str::uuid()->toString();
        }

        foreach (['locations', 'participants', 'alerts', 'links'] as $mapKey) {
            if (! isset($event[$mapKey]) || ! is_array($event[$mapKey])) {
                continue;
            }
            $normalized = [];
            foreach ($event[$mapKey] as $id => $entry) {
                if (! is_array($entry)) {
                    continue;
                }
                if (! isset($entry['@type'])) {
                    $entry['@type'] = match ($mapKey) {
                        'locations' => 'Location',
                        'participants' => 'Participant',
                        'alerts' => 'Alert',
                        'links' => 'Link',
                        default => null,
                    };
                }
                $normalized[(string) $id] = $entry;
            }
            if ($normalized !== []) {
                $event[$mapKey] = $normalized;
            }
        }

        if ($existing !== null && isset($existing['calendarIds']) && is_array($existing['calendarIds'])
            && (! isset($event['calendarIds']) || ! is_array($event['calendarIds']))) {
            $event['calendarIds'] = $existing['calendarIds'];
        }

        return $event;
    }

    public static function deriveTitle(array $event): string
    {
        if (isset($event['title']) && is_string($event['title']) && trim($event['title']) !== '') {
            return trim($event['title']);
        }

        return 'event';
    }

    /**
     * @return array{objectId: string, veventUid: string|null}
     */
    public static function parseEventId(string $eventId): array
    {
        $eventId = rawurldecode($eventId);
        $pos = strpos($eventId, '#');
        if ($pos === false) {
            return ['objectId' => $eventId, 'veventUid' => null];
        }

        return [
            'objectId' => substr($eventId, 0, $pos),
            'veventUid' => substr($eventId, $pos + 1),
        ];
    }

    public static function compositeEventId(string $objectId, string $veventUid): string
    {
        return $objectId.'#'.$veventUid;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function alertFromValarm(VAlarm $valarm): ?array
    {
        $parsed = ICalendarAlarmTrigger::fromValarm($valarm);
        if ($parsed === null) {
            return null;
        }

        $action = isset($valarm->ACTION)
            ? strtolower(trim((string) $valarm->ACTION->getValue()))
            : 'display';
        if (! in_array($action, ['display', 'audio', 'email'], true)) {
            $action = 'display';
        }

        $alert = [
            '@type' => 'Alert',
            'action' => $action,
        ];

        if ($parsed['kind'] === 'absolute') {
            $alert['trigger'] = [
                '@type' => 'AbsoluteAlert',
                'when' => $parsed['when'],
            ];

            return $alert;
        }

        $relative = [
            '@type' => 'RelativeAlert',
            'offset' => $parsed['offset'],
        ];
        if ($parsed['relatedTo'] !== 'start') {
            $relative['relatedTo'] = $parsed['relatedTo'];
        }
        $alert['trigger'] = $relative;

        return $alert;
    }

    /**
     * @param  array<string, mixed>  $alert
     */
    public static function writeValarm(VEvent $vevent, array $alert, ?string $eventTitle = null): void
    {
        $triggerData = $alert['trigger'] ?? null;
        if (! is_array($triggerData)) {
            return;
        }

        $triggerProps = ICalendarAlarmTrigger::toIcsParts($triggerData);
        if ($triggerProps === null) {
            return;
        }

        $action = isset($alert['action']) && is_string($alert['action'])
            ? strtoupper($alert['action'])
            : 'DISPLAY';
        if (! in_array($action, ['DISPLAY', 'AUDIO', 'EMAIL'], true)) {
            $action = 'DISPLAY';
        }

        $valarm = $vevent->add('VALARM', []);
        $valarm->add('ACTION', $action);
        $valarm->add('TRIGGER', $triggerProps['value'], $triggerProps['params']);

        if ($action === 'DISPLAY') {
            $valarm->add('DESCRIPTION', 'Reminder');
        }

        if ($action === 'EMAIL') {
            $summary = is_string($eventTitle) && trim($eventTitle) !== ''
                ? trim($eventTitle)
                : 'Reminder';
            $valarm->add('SUMMARY', $summary);
            $valarm->add('ATTENDEE', 'mailto:organizer@invalid');
        }
    }

    /**
     * @param  array<int|string, mixed>  $value
     */
    private static function isAssociativeMap(array $value): bool
    {
        if ($value === []) {
            return true;
        }

        return array_keys($value) !== range(0, count($value) - 1);
    }
}
