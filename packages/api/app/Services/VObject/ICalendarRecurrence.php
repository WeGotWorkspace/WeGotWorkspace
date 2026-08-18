<?php

declare(strict_types=1);

namespace App\Services\VObject;

use Sabre\VObject\Property;

/**
 * RRULE / EXRULE ↔ JSCalendar RecurrenceRule.
 *
 * Parsing uses Sabre Recur::getParts(). $legacyWireTypes keeps the pre-RFC-8984
 * shapes (byMonth Int[], byDay iCal strings, no byHour/byMinute/bySecond) for
 * the tasks domain, which has shipped consumers of that wire format.
 */
final class ICalendarRecurrence
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
     * @return array<string, mixed>
     */
    public static function ruleFromProperty(Property $property, bool $legacyWireTypes = false): array
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
                ? ICalendarDateTime::toJmap($until)
                : (strlen($until) === 8
                    ? ICalendarDateTime::toJmap($until)
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
     * @param  array<string, mixed>  $rule
     */
    public static function ruleToIcs(array $rule): string
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
                ? ICalendarDateTime::toIcs($until)
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
     * @return list<string>
     */
    private static function rulePartValues(mixed $part): array
    {
        $values = is_array($part) ? $part : explode(',', (string) $part);
        $values = array_map(static fn (mixed $value): string => trim((string) $value), $values);

        return array_values(array_filter($values, static fn (string $value): bool => $value !== ''));
    }

    /**
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

    private static function normalizeByMonthValue(string $value): string
    {
        if (preg_match('/^0*(\d+)(l?)$/i', trim($value), $matches) === 1) {
            return $matches[1].strtoupper($matches[2]);
        }

        return trim($value);
    }

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
}
