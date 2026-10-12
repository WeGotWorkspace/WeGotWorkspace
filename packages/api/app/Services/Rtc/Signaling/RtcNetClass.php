<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

/**
 * Network class a peer measured for itself before joining. Stored as a hint
 * for the other peers and for the real-time health page; anything unexpected
 * is dropped rather than stored.
 */
final class RtcNetClass
{
    /** @var list<string> */
    public const KNOWN = ['open', 'symmetric', 'udp-blocked', 'unknown'];

    public static function normalize(mixed $value): string
    {
        return is_string($value) && in_array($value, self::KNOWN, true) ? $value : '';
    }
}
