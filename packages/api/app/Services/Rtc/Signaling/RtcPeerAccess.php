<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

/**
 * Collaboration rights on a peer row (contract C1). The column defaults to
 * `read` and only the join path writes it, so a row that skipped that write —
 * or carries anything unexpected — reads as read-only.
 */
final class RtcPeerAccess
{
    public const READ = 'read';

    public const COMMENT = 'comment';

    public const WRITE = 'write';

    public static function normalize(mixed $value): string
    {
        return in_array($value, [self::COMMENT, self::WRITE], true) ? (string) $value : self::READ;
    }
}
