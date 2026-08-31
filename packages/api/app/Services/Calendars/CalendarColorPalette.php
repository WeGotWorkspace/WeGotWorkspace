<?php

declare(strict_types=1);

namespace App\Services\Calendars;

/**
 * Distinct colors for provisioned calendars and task lists.
 *
 * Swatches match the calendar picker in packages/apps (`CALENDAR_COLOR_SWATCHES`).
 * Must fit MySQL `calendarinstances.calendarcolor` VARBINARY(10).
 */
final class CalendarColorPalette
{
    /** Sabre CalDAV PDO maps this Apple property onto `calendarinstances.calendarcolor`. */
    public const PROPERTY = '{http://apple.com/ns/ical/}calendar-color';

    /** Legacy unset UI fallback — every colorless calendar rendered as this indigo. */
    public const SHARED_DEFAULT = '#6366f1';

    /** @var list<string> */
    public const SWATCHES = [
        self::SHARED_DEFAULT,
        '#0ea5e9',
        '#22c55e',
        '#f59e0b',
        '#ec4899',
        '#ef4444',
        '#8b5cf6',
        '#14b8a6',
    ];

    /**
     * Fixed colors for reserved personal collections so default/home/work (and task lists)
     * are always distinct from each other.
     *
     * @var array<string, string>
     */
    private const RESERVED_URI_COLORS = [
        CalendarCollectionUris::EVENT_DEFAULT => self::SHARED_DEFAULT,
        CalendarCollectionUris::EVENT_HOME => '#0ea5e9',
        CalendarCollectionUris::EVENT_WORK => '#22c55e',
        CalendarCollectionUris::TASK_INBOX => '#f59e0b',
        CalendarCollectionUris::TASK_HOME => '#ec4899',
        CalendarCollectionUris::TASK_WORK => '#8b5cf6',
        CalendarCollectionUris::NOTE_GENERAL => '#14b8a6',
    ];

    public static function forUri(string $uri): string
    {
        $uri = trim($uri);
        if (self::isReservedPersonalUri($uri)) {
            return self::RESERVED_URI_COLORS[$uri];
        }

        return self::hashToSwatch($uri);
    }

    public static function isReservedPersonalUri(string $uri): bool
    {
        return $uri !== '' && isset(self::RESERVED_URI_COLORS[$uri]);
    }

    /**
     * True when the stored color is missing or still the shared indigo fallback
     * (including Apple `#RRGGBBAA` forms).
     */
    public static function isBlankOrSharedDefault(mixed $color): bool
    {
        $normalized = self::normalize($color);

        return $normalized === null || $normalized === self::SHARED_DEFAULT;
    }

    public static function normalize(mixed $color): ?string
    {
        if (! is_string($color)) {
            return null;
        }

        $trimmed = strtolower(trim($color));
        if ($trimmed === '') {
            return null;
        }

        if (preg_match('/^#([0-9a-f]{6})([0-9a-f]{2})?$/', $trimmed, $matches) === 1) {
            return '#'.$matches[1];
        }

        return $trimmed;
    }

    /**
     * Extra / group URIs hash onto swatches after indigo so they do not all collapse
     * to the legacy shared default.
     */
    private static function hashToSwatch(string $seed): string
    {
        $swatches = self::SWATCHES;
        $count = count($swatches);
        if ($count < 2) {
            return $swatches[0];
        }

        $hash = 0;
        $length = strlen($seed);
        for ($i = 0; $i < $length; $i++) {
            $hash = ($hash * 31 + ord($seed[$i])) % 4_294_967_296;
        }

        return $swatches[1 + ($hash % ($count - 1))];
    }
}
