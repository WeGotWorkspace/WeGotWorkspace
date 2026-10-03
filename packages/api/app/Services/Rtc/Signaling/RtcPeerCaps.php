<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

/**
 * Wire capabilities a peer advertises at join (contract C8). This release only
 * stores and mirrors them on rosters; the features behind each flag land in
 * later work. Unknown values are dropped so the column cannot be used as a
 * free-text side channel.
 */
final class RtcPeerCaps
{
    /** @var list<string> */
    public const KNOWN = ['bin', 'ice-batch', 'ticket', 'meet-dc', 'yjs-http', 'relay-jit', 'since-ack'];

    private const MAX_LENGTH = 190;

    /** Comma-separated for the peer row. */
    public static function encode(mixed $value): string
    {
        if (! is_array($value)) {
            return '';
        }

        $caps = [];
        foreach ($value as $cap) {
            if (is_string($cap) && in_array($cap, self::KNOWN, true) && ! in_array($cap, $caps, true)) {
                $caps[] = $cap;
            }
        }

        return mb_substr(implode(',', $caps), 0, self::MAX_LENGTH);
    }

    /**
     * @return list<string>
     */
    public static function decode(mixed $stored): array
    {
        if (! is_string($stored) || trim($stored) === '') {
            return [];
        }

        return array_values(array_filter(
            array_map('trim', explode(',', $stored)),
            static fn (string $cap): bool => in_array($cap, self::KNOWN, true),
        ));
    }
}
