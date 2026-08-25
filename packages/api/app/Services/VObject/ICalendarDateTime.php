<?php

declare(strict_types=1);

namespace App\Services\VObject;

use DateTimeImmutable;
use DateTimeZone;
use Sabre\VObject\Component;
use Sabre\VObject\DateTimeParser;
use Sabre\VObject\InvalidDataException;
use Sabre\VObject\Property;
use Sabre\VObject\Property\ICalendar\DateTime as IcsDateTime;

/**
 * iCalendar DATE / DATE-TIME ↔ JSCalendar LocalDateTime (RFC 8984 §1.4.4).
 *
 * Read path uses Sabre's DateTime property (getJsonValue / hasTime / TZID).
 * Compact ICS strings that are not already on a DateTime property go through
 * DateTimeParser — never hand-sliced YYYYMMDD tokens.
 */
final class ICalendarDateTime
{
    /**
     * @return array{value: string, showWithoutTime: bool, timeZone: string|null}
     */
    public static function fromProperty(Property $property): array
    {
        $tzid = isset($property['TZID']) ? trim((string) $property['TZID']) : null;
        if ($tzid === '') {
            $tzid = null;
        }

        if ($property instanceof IcsDateTime && $property->getParts() !== []) {
            try {
                $json = $property->getJsonValue();
                $value = isset($json[0]) && is_string($json[0]) ? $json[0] : '';
                if ($value !== '') {
                    return [
                        'value' => $value,
                        'showWithoutTime' => ! $property->hasTime(),
                        'timeZone' => $tzid,
                    ];
                }
            } catch (\Throwable) {
                // Fall through to raw-value parsing.
            }
        }

        $raw = trim((string) $property->getValue());
        $isDate = isset($property['VALUE']) && strtoupper((string) $property['VALUE']) === 'DATE';

        return [
            'value' => self::toJmap($raw),
            'showWithoutTime' => $isDate,
            'timeZone' => $tzid,
        ];
    }

    /**
     * Compact ICS (`20260615T100000Z`, `20260704`) or already-hyphenated JMAP
     * local/UTC → JSCalendar LocalDateTime / date.
     */
    public static function toJmap(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return $trimmed;
        }

        if (str_contains($trimmed, '-') || str_contains($trimmed, ':')) {
            return $trimmed;
        }

        try {
            if (strlen($trimmed) === 8) {
                return DateTimeParser::parseDate($trimmed)->format('Y-m-d');
            }

            $hasZ = str_ends_with($trimmed, 'Z');
            $dt = DateTimeParser::parseDateTime($trimmed);

            return $hasZ
                ? $dt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z')
                : $dt->format('Y-m-d\TH:i:s');
        } catch (InvalidDataException) {
            return $trimmed;
        }
    }

    /**
     * JSCalendar LocalDateTime / date → compact iCalendar DATE-TIME / DATE.
     */
    public static function toIcs(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return $trimmed;
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed) === 1) {
            return str_replace('-', '', $trimmed);
        }

        if (str_ends_with($trimmed, 'Z')) {
            try {
                return (new DateTimeImmutable($trimmed))
                    ->setTimezone(new DateTimeZone('UTC'))
                    ->format('Ymd\THis\Z');
            } catch (\Exception) {
                return str_replace(['-', ':'], '', substr($trimmed, 0, -1)).'Z';
            }
        }

        if (str_contains($trimmed, 'T')) {
            try {
                return (new DateTimeImmutable($trimmed))->format('Ymd\THis');
            } catch (\Exception) {
                return str_replace(['-', ':'], '', $trimmed);
            }
        }

        return $trimmed;
    }

    public static function writeProperty(
        Component $component,
        string $name,
        mixed $value,
        bool $showWithoutTime,
        ?string $timeZone,
    ): void {
        if (! is_string($value) || trim($value) === '') {
            return;
        }

        $params = [];
        if ($showWithoutTime) {
            $params['VALUE'] = 'DATE';
            $icsValue = self::toIcs(substr(trim($value), 0, 10));
        } else {
            $icsValue = self::toIcs($value);
            if (self::isUtcIdentifier($timeZone)) {
                if (! str_ends_with($icsValue, 'Z')) {
                    $icsValue .= 'Z';
                }
            } elseif (! str_ends_with(trim($value), 'Z') && $timeZone !== null && $timeZone !== '') {
                try {
                    new DateTimeZone($timeZone);
                    $params['TZID'] = $timeZone;
                } catch (\Exception) {
                    // Unknown TZID: write floating local time rather than a dangling TZID.
                }
            }
        }

        $component->add($name, $icsValue, $params);
    }

    private static function isUtcIdentifier(?string $timeZone): bool
    {
        if ($timeZone === null || trim($timeZone) === '') {
            return false;
        }

        return in_array(
            strtoupper(str_replace(' ', '', $timeZone)),
            ['UTC', 'ETC/UTC', 'GMT', 'ETC/GMT', 'Z'],
            true,
        );
    }
}
