<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Component\VTodo;
use Sabre\VObject\Property;

/**
 * Rejects sub-hourly recurrence on calendar writes. Hourly rules are allowed
 * unless INTERVAL is below 1.
 */
final class RecurrenceRuleGuard
{
    public const MESSAGE = 'Minutely and secondly recurrence is not supported.';

    public static function assertAllowed(VCalendar $calendar): void
    {
        foreach ($calendar->getComponents() as $component) {
            if (! $component instanceof VEvent && ! $component instanceof VTodo) {
                continue;
            }
            foreach ($component->select('RRULE') as $property) {
                if (! $property instanceof Property) {
                    continue;
                }
                self::assertParts($property->getParts());
            }
        }
    }

    /**
     * @param  array<mixed>  $parts
     */
    private static function assertParts(array $parts): void
    {
        $frequency = strtoupper((string) ($parts['FREQ'] ?? ''));
        if ($frequency === 'SECONDLY' || $frequency === 'MINUTELY') {
            throw new ApiHttpException(400, self::MESSAGE, 'invalid_recurrence');
        }
        if ($frequency === 'HOURLY' && self::interval($parts) < 1) {
            throw new ApiHttpException(400, self::MESSAGE, 'invalid_recurrence');
        }
    }

    /**
     * @param  array<mixed>  $parts
     */
    private static function interval(array $parts): int
    {
        if (! isset($parts['INTERVAL'])) {
            return 1;
        }
        $raw = $parts['INTERVAL'];
        if (is_array($raw)) {
            $raw = $raw[0] ?? 1;
        }

        return (int) $raw;
    }
}
