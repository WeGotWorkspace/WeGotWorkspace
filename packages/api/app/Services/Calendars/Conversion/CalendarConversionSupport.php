<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use Illuminate\Support\Str;
use Sabre\VObject\Component;
use Sabre\VObject\Component\VAlarm;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Property;

/**
 * Shared helpers for iCalendar VEVENT ↔ JMAP CalendarEvent conversion.
 *
 * Multi-VEVENT ICS: CalDAV stores one .ics blob per calendar object URI. When a
 * resource contains multiple VEVENT components, each maps to its own JMAP
 * CalendarEvent with composite id `{objectUri}#{veventUid}`. POST always writes
 * a single-VEVENT object; PUT/PATCH/DELETE on a composite id target one VEVENT.
 */
final class CalendarConversionSupport
{
    /** @var array<string, string> */
    private const FREQUENCY_MAP = [
        'SECONDLY' => 'secondly',
        'MINUTELY' => 'minutely',
        'HOURLY' => 'hourly',
        'DAILY' => 'daily',
        'WEEKLY' => 'weekly',
        'MONTHLY' => 'monthly',
        'YEARLY' => 'yearly',
    ];

    /** @var array<string, string> */
    private const FREQUENCY_TO_ICS = [
        'secondly' => 'SECONDLY',
        'minutely' => 'MINUTELY',
        'hourly' => 'HOURLY',
        'daily' => 'DAILY',
        'weekly' => 'WEEKLY',
        'monthly' => 'MONTHLY',
        'yearly' => 'YEARLY',
    ];

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

    public static function normalizeUtcDateTime(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return $trimmed;
        }

        if (preg_match('/^\d{8}T\d{6}Z$/', $trimmed) === 1) {
            $trimmed = substr($trimmed, 0, 4).'-'
                .substr($trimmed, 4, 2).'-'
                .substr($trimmed, 6, 2).'T'
                .substr($trimmed, 9, 2).':'
                .substr($trimmed, 11, 2).':'
                .substr($trimmed, 13, 2).'Z';
        }

        if (preg_match('/^\d{8}T\d{6}$/', $trimmed) === 1) {
            $trimmed = substr($trimmed, 0, 4).'-'
                .substr($trimmed, 4, 2).'-'
                .substr($trimmed, 6, 2).'T'
                .substr($trimmed, 9, 2).':'
                .substr($trimmed, 11, 2).':'
                .substr($trimmed, 13, 2);
        }

        return $trimmed;
    }

    public static function utcDateTimeToIcs(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return $trimmed;
        }

        if (str_ends_with($trimmed, 'Z')) {
            return str_replace(['-', ':'], '', substr($trimmed, 0, -1)).'Z';
        }

        return str_replace(['-', ':'], '', $trimmed);
    }

    /**
     * @return array{value: string, showWithoutTime: bool, timeZone: string|null}
     */
    public static function jmapDateTimeFromProperty(Property $property): array
    {
        $raw = trim((string) $property->getValue());
        $isDate = isset($property['VALUE']) && strtoupper((string) $property['VALUE']) === 'DATE';
        $tzid = isset($property['TZID']) ? trim((string) $property['TZID']) : null;

        if ($isDate) {
            $normalized = strlen($raw) === 8
                ? substr($raw, 0, 4).'-'.substr($raw, 4, 2).'-'.substr($raw, 6, 2)
                : self::normalizeUtcDateTime($raw);

            return [
                'value' => $normalized,
                'showWithoutTime' => true,
                'timeZone' => $tzid,
            ];
        }

        return [
            'value' => self::normalizeUtcDateTime($raw),
            'showWithoutTime' => false,
            'timeZone' => $tzid,
        ];
    }

    /**
     * ISO 8601 duration from two JMAP local/UTC date-times (or all-day dates).
     * Used so DTEND-based CalDAV events also expose RFC 8984 `duration`.
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
        if ($interval->invert === 1) {
            return null;
        }

        $parts = 'P';
        if ($interval->y > 0) {
            $parts .= $interval->y.'Y';
        }
        if ($interval->m > 0) {
            $parts .= $interval->m.'M';
        }
        if ($interval->d > 0) {
            $parts .= $interval->d.'D';
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
     * @param  array<string, mixed>  $event
     */
    public static function writeDateTimeProperty(Component $component, string $name, mixed $value, bool $showWithoutTime, ?string $timeZone): void
    {
        if (! is_string($value) || trim($value) === '') {
            return;
        }

        $params = [];
        if ($showWithoutTime) {
            $params['VALUE'] = 'DATE';
            $icsValue = str_replace('-', '', substr($value, 0, 10));
        } else {
            $icsValue = self::utcDateTimeToIcs($value);
            if (! str_ends_with($value, 'Z') && $timeZone !== null && $timeZone !== '') {
                $params['TZID'] = $timeZone;
            }
        }

        $component->add($name, $icsValue, $params);
    }

    /**
     * Parse an RRULE/EXRULE property into a JSCalendar RecurrenceRule (RFC 8984 §4.3.3):
     * byMonth is String[] (leap-month suffix "3L"), byDay is NDay[] objects, and
     * byHour/byMinute/bySecond are UnsignedInt[].
     *
     * $legacyWireTypes keeps the pre-RFC-8984 shapes (byMonth Int[], byDay iCal
     * strings, no byHour/byMinute/bySecond) for the tasks domain, which has shipped
     * consumers of the legacy wire format.
     *
     * @return array<string, mixed>
     */
    public static function recurrenceRuleFromProperty(Property $property, bool $legacyWireTypes = false): array
    {
        $parts = $property->getParts();
        $frequency = strtoupper((string) ($parts['FREQ'] ?? ''));
        $rule = [
            '@type' => 'RecurrenceRule',
            'frequency' => self::FREQUENCY_MAP[$frequency] ?? strtolower($frequency),
        ];

        if (isset($parts['INTERVAL'])) {
            $rule['interval'] = (int) $parts['INTERVAL'];
        }
        if (isset($parts['COUNT'])) {
            $rule['count'] = (int) $parts['COUNT'];
        }
        if (isset($parts['UNTIL'])) {
            $until = (string) $parts['UNTIL'];
            $rule['until'] = str_contains($until, 'T')
                ? self::normalizeUtcDateTime($until)
                : (strlen($until) === 8
                    ? substr($until, 0, 4).'-'.substr($until, 4, 2).'-'.substr($until, 6, 2)
                    : $until);
        }
        if (isset($parts['BYDAY'])) {
            $days = self::rulePartValues($parts['BYDAY']);
            $rule['byDay'] = $legacyWireTypes
                ? $days
                : array_values(array_filter(
                    array_map(self::nDayFromIcs(...), $days),
                    static fn (?array $nDay): bool => $nDay !== null,
                ));
        }
        if (isset($parts['BYMONTH'])) {
            $months = self::rulePartValues($parts['BYMONTH']);
            $rule['byMonth'] = $legacyWireTypes
                ? array_map('intval', $months)
                : array_map(self::normalizeByMonthValue(...), $months);
        }
        if (isset($parts['BYMONTHDAY'])) {
            $rule['byMonthDay'] = array_map('intval', self::rulePartValues($parts['BYMONTHDAY']));
        }
        if (isset($parts['BYYEARDAY'])) {
            $rule['byYearDay'] = array_map('intval', self::rulePartValues($parts['BYYEARDAY']));
        }
        if (isset($parts['BYWEEKNO'])) {
            $rule['byWeekNo'] = array_map('intval', self::rulePartValues($parts['BYWEEKNO']));
        }
        if (isset($parts['BYSETPOS'])) {
            $rule['bySetPosition'] = array_map('intval', self::rulePartValues($parts['BYSETPOS']));
        }
        if (! $legacyWireTypes) {
            foreach (['BYHOUR' => 'byHour', 'BYMINUTE' => 'byMinute', 'BYSECOND' => 'bySecond'] as $icsPart => $jmapKey) {
                if (isset($parts[$icsPart])) {
                    $rule[$jmapKey] = array_map('intval', self::rulePartValues($parts[$icsPart]));
                }
            }
        }
        if (isset($parts['WKST'])) {
            $rule['firstDayOfWeek'] = strtolower((string) $parts['WKST']);
        }

        return $rule;
    }

    /**
     * Sabre's Recur property exposes multi-value rule parts (BYDAY=MO,TU) as arrays
     * and single values as strings; normalize both to a clean list of strings.
     *
     * @return list<string>
     */
    private static function rulePartValues(mixed $part): array
    {
        $values = is_array($part) ? $part : explode(',', (string) $part);
        $values = array_map(static fn (mixed $value): string => trim((string) $value), $values);

        return array_values(array_filter($values, static fn (string $value): bool => $value !== ''));
    }

    /**
     * iCal BYDAY value ("MO", "+2MO", "-1SU") → RFC 8984 NDay object.
     *
     * @return array{'@type': string, day: string, nthOfPeriod?: int}|null
     */
    private static function nDayFromIcs(string $value): ?array
    {
        if (preg_match('/^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i', trim($value), $matches) !== 1) {
            return null;
        }

        $nDay = ['@type' => 'NDay', 'day' => strtolower($matches[2])];
        if ($matches[1] !== '') {
            $nDay['nthOfPeriod'] = (int) $matches[1];
        }

        return $nDay;
    }

    /**
     * Canonicalize an iCal BYMONTH value to the RFC 8984 string form: strip leading
     * zeros, uppercase the leap-month suffix ("03" → "3", "3l" → "3L").
     */
    private static function normalizeByMonthValue(string $value): string
    {
        if (preg_match('/^0*(\d+)(l?)$/i', trim($value), $matches) === 1) {
            return $matches[1].strtoupper($matches[2]);
        }

        return trim($value);
    }

    /**
     * NDay object (RFC 8984) or legacy iCal day string → iCal BYDAY value.
     */
    private static function byDayValueToIcs(mixed $value): ?string
    {
        if (is_array($value)) {
            $day = $value['day'] ?? null;
            if (! is_string($day) || trim($day) === '') {
                return null;
            }
            $ordinal = isset($value['nthOfPeriod']) && is_numeric($value['nthOfPeriod'])
                ? (string) (int) $value['nthOfPeriod']
                : '';

            return $ordinal.strtoupper(trim($day));
        }

        if (is_string($value) && trim($value) !== '') {
            return strtoupper(trim($value));
        }

        return null;
    }

    /**
     * Serialize a JSCalendar RecurrenceRule to an RRULE/EXRULE value. Accepts both
     * RFC 8984 wire shapes (byMonth String[], byDay NDay[]) and the legacy shapes
     * still produced by the tasks domain (byMonth Int[], byDay iCal strings).
     *
     * @param  array<string, mixed>  $rule
     */
    public static function recurrenceRuleToIcs(array $rule): string
    {
        $parts = [];
        $frequency = strtolower((string) ($rule['frequency'] ?? ''));
        $parts[] = 'FREQ='.(self::FREQUENCY_TO_ICS[$frequency] ?? strtoupper($frequency));

        if (isset($rule['interval']) && (int) $rule['interval'] > 1) {
            $parts[] = 'INTERVAL='.(int) $rule['interval'];
        }
        if (isset($rule['count'])) {
            $parts[] = 'COUNT='.(int) $rule['count'];
        }
        if (isset($rule['until']) && is_string($rule['until'])) {
            $until = $rule['until'];
            $parts[] = 'UNTIL='.(str_contains($until, 'T')
                ? self::utcDateTimeToIcs($until)
                : str_replace('-', '', substr($until, 0, 10)));
        }
        if (isset($rule['byDay']) && is_array($rule['byDay']) && $rule['byDay'] !== []) {
            $days = array_values(array_filter(
                array_map(self::byDayValueToIcs(...), $rule['byDay']),
                static fn (?string $day): bool => $day !== null,
            ));
            if ($days !== []) {
                $parts[] = 'BYDAY='.implode(',', $days);
            }
        }
        if (isset($rule['byMonth']) && is_array($rule['byMonth']) && $rule['byMonth'] !== []) {
            $parts[] = 'BYMONTH='.implode(',', array_map(
                static fn (mixed $value): string => strtoupper((string) $value),
                $rule['byMonth'],
            ));
        }
        if (isset($rule['byMonthDay']) && is_array($rule['byMonthDay']) && $rule['byMonthDay'] !== []) {
            $parts[] = 'BYMONTHDAY='.implode(',', array_map('strval', $rule['byMonthDay']));
        }
        if (isset($rule['byYearDay']) && is_array($rule['byYearDay']) && $rule['byYearDay'] !== []) {
            $parts[] = 'BYYEARDAY='.implode(',', array_map('strval', $rule['byYearDay']));
        }
        if (isset($rule['byWeekNo']) && is_array($rule['byWeekNo']) && $rule['byWeekNo'] !== []) {
            $parts[] = 'BYWEEKNO='.implode(',', array_map('strval', $rule['byWeekNo']));
        }
        if (isset($rule['bySetPosition']) && is_array($rule['bySetPosition']) && $rule['bySetPosition'] !== []) {
            $parts[] = 'BYSETPOS='.implode(',', array_map('strval', $rule['bySetPosition']));
        }
        foreach (['byHour' => 'BYHOUR', 'byMinute' => 'BYMINUTE', 'bySecond' => 'BYSECOND'] as $jmapKey => $icsPart) {
            if (isset($rule[$jmapKey]) && is_array($rule[$jmapKey]) && $rule[$jmapKey] !== []) {
                $parts[] = $icsPart.'='.implode(',', array_map('intval', $rule[$jmapKey]));
            }
        }
        if (isset($rule['firstDayOfWeek']) && is_string($rule['firstDayOfWeek']) && $rule['firstDayOfWeek'] !== '') {
            $parts[] = 'WKST='.strtoupper($rule['firstDayOfWeek']);
        }

        return implode(';', $parts);
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

        foreach (['locations', 'participants', 'alerts'] as $mapKey) {
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

    public static function generateUid(string $seed): string
    {
        $hash = hash('sha256', $seed);

        return sprintf(
            'urn:uuid:%s-%s-%s-%s-%s',
            substr($hash, 0, 8),
            substr($hash, 8, 4),
            substr($hash, 12, 4),
            substr($hash, 16, 4),
            substr($hash, 20, 12),
        );
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
        if (! isset($valarm->TRIGGER)) {
            return null;
        }

        $trigger = $valarm->TRIGGER;
        $triggerValue = trim((string) $trigger->getValue());
        if ($triggerValue === '') {
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

        $isDateTime = isset($trigger['VALUE'])
            && strtoupper((string) $trigger['VALUE']) === 'DATE-TIME';
        if ($isDateTime || preg_match('/^\d{8}T\d{6}Z?$/', $triggerValue) === 1) {
            $alert['trigger'] = [
                '@type' => 'AbsoluteAlert',
                'when' => self::normalizeUtcDateTime($triggerValue),
            ];

            return $alert;
        }

        $relatedTo = isset($trigger['RELATED'])
            && strtoupper((string) $trigger['RELATED']) === 'END'
            ? 'end'
            : 'start';

        $relative = [
            '@type' => 'RelativeAlert',
            'offset' => $triggerValue,
        ];
        if ($relatedTo !== 'start') {
            $relative['relatedTo'] = $relatedTo;
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

        $triggerProps = self::valarmTriggerFromJmap($triggerData);
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
     * @param  array<string, mixed>  $trigger
     * @return array{value: string, params: array<string, string>}|null
     */
    private static function valarmTriggerFromJmap(array $trigger): ?array
    {
        $type = $trigger['@type'] ?? '';

        if ($type === 'AbsoluteAlert' || isset($trigger['when'])) {
            $when = $trigger['when'] ?? null;
            if (! is_string($when) || trim($when) === '') {
                return null;
            }

            return [
                'value' => self::utcDateTimeToIcs($when),
                'params' => ['VALUE' => 'DATE-TIME'],
            ];
        }

        if ($type === 'RelativeAlert' || isset($trigger['offset'])) {
            $offset = $trigger['offset'] ?? null;
            if (! is_string($offset) || trim($offset) === '') {
                return null;
            }

            $params = [];
            $relatedTo = isset($trigger['relatedTo']) && is_string($trigger['relatedTo'])
                ? strtolower($trigger['relatedTo'])
                : 'start';
            if ($relatedTo === 'end') {
                $params['RELATED'] = 'END';
            }

            return [
                'value' => $offset,
                'params' => $params,
            ];
        }

        return null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function taskAlertFromValarm(Component $valarm): ?array
    {
        if (! isset($valarm->TRIGGER)) {
            return null;
        }

        $triggerValue = trim((string) $valarm->TRIGGER->getValue());
        if ($triggerValue === '') {
            return null;
        }

        $related = isset($valarm->TRIGGER['RELATED'])
            ? strtoupper(trim((string) $valarm->TRIGGER['RELATED']))
            : 'START';
        $relativeTo = $related === 'END' ? 'end' : 'start';

        if (preg_match('/^-?P/i', $triggerValue) === 1) {
            $trigger = [
                '@type' => 'OffsetTrigger',
                'offset' => $triggerValue,
                'relativeTo' => $relativeTo,
            ];
        } else {
            $trigger = [
                '@type' => 'AbsoluteTrigger',
                'when' => self::normalizeUtcDateTime($triggerValue),
            ];
        }

        $alert = [
            '@type' => 'Alert',
            'trigger' => $trigger,
        ];

        if (isset($valarm->ACTION)) {
            $action = strtolower(trim((string) $valarm->ACTION->getValue()));
            if (in_array($action, ['display', 'email'], true)) {
                $alert['action'] = $action;
            }
        }

        if (isset($valarm->ACKNOWLEDGED)) {
            $alert['acknowledged'] = self::normalizeUtcDateTime((string) $valarm->ACKNOWLEDGED->getValue());
        }

        return $alert;
    }

    /**
     * @param  array<string, mixed>  $alerts
     */
    public static function writeValarmComponents(Component $parent, array $alerts): void
    {
        foreach ($alerts as $entry) {
            if (! is_array($entry)) {
                continue;
            }

            $trigger = $entry['trigger'] ?? null;
            if (! is_array($trigger)) {
                continue;
            }

            $valarm = $parent->add('VALARM');
            $action = isset($entry['action']) && is_string($entry['action'])
                ? strtoupper($entry['action'])
                : 'DISPLAY';
            $valarm->add('ACTION', $action);

            if (($trigger['@type'] ?? '') === 'OffsetTrigger' && isset($trigger['offset']) && is_string($trigger['offset'])) {
                $params = [];
                $relativeTo = strtolower((string) ($trigger['relativeTo'] ?? 'start'));
                if ($relativeTo === 'end') {
                    $params['RELATED'] = 'END';
                }
                $valarm->add('TRIGGER', $trigger['offset'], $params);
            } elseif (($trigger['@type'] ?? '') === 'AbsoluteTrigger'
                && isset($trigger['when'])
                && is_string($trigger['when'])
                && trim($trigger['when']) !== '') {
                $valarm->add('TRIGGER', self::utcDateTimeToIcs($trigger['when']));
            } else {
                $parent->remove($valarm);

                continue;
            }

            if (isset($entry['acknowledged']) && is_string($entry['acknowledged']) && trim($entry['acknowledged']) !== '') {
                $valarm->add('ACKNOWLEDGED', self::utcDateTimeToIcs($entry['acknowledged']));
            }
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
