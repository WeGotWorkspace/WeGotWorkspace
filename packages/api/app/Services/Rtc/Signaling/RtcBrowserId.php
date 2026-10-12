<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

/**
 * Client token that identifies a browser profile (localStorage).
 * Invalid or missing values are ignored — join still succeeds, leftover
 * peers are just not evicted.
 */
final class RtcBrowserId
{
    /**
     * @param  array<string, mixed>  $body
     * @return non-empty-string|null
     */
    public static function read(array $body): ?string
    {
        $raw = $body['browserId'] ?? null;
        if (! is_string($raw) || preg_match('/^[a-f0-9]{32}$/', $raw) !== 1) {
            return null;
        }

        return $raw;
    }
}
