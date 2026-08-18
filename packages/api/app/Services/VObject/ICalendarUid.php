<?php

declare(strict_types=1);

namespace App\Services\VObject;

/**
 * Deterministic urn:uuid for iCalendar/vCard objects that shipped without UID.
 */
final class ICalendarUid
{
    public static function fromSeed(string $seed): string
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
}
