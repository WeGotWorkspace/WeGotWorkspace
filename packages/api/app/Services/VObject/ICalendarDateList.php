<?php

declare(strict_types=1);

namespace App\Services\VObject;

use Sabre\VObject\Property;
use Sabre\VObject\Property\ICalendar\DateTime as IcsDateTime;

/**
 * Multi-value EXDATE / RDATE lists via Sabre DateTime::getJsonValue / getParts.
 */
final class ICalendarDateList
{
    /**
     * @return list<string>
     */
    public static function jmapValuesFromProperty(Property $property): array
    {
        if ($property instanceof IcsDateTime && $property->getParts() !== []) {
            try {
                $values = [];
                foreach ($property->getJsonValue() as $value) {
                    if (is_string($value) && $value !== '') {
                        $values[] = $value;
                    }
                }

                return $values;
            } catch (\Throwable) {
                // Fall through to getParts().
            }
        }

        $values = [];
        foreach ($property->getParts() as $part) {
            $normalized = ICalendarDateTime::toJmap(trim((string) $part));
            if ($normalized !== '') {
                $values[] = $normalized;
            }
        }

        return $values;
    }

    /**
     * @param  list<mixed>  $jmapValues
     * @return list<string>
     */
    public static function toIcsValues(array $jmapValues): array
    {
        $values = [];
        foreach ($jmapValues as $value) {
            if (! is_string($value) || trim($value) === '') {
                continue;
            }
            $ics = ICalendarDateTime::toIcs($value);
            if ($ics !== '') {
                $values[] = $ics;
            }
        }

        return $values;
    }
}
