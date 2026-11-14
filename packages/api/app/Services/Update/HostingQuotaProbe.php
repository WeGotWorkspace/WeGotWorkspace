<?php

declare(strict_types=1);

namespace App\Services\Update;

use Illuminate\Support\Facades\Cache;

/**
 * Free space left in the hosting account's disk quota, from `quota -s`.
 *
 * Reading it starts a shell. The admin update page polls its state every few
 * seconds, so that path reads the cached value (at most one shell per
 * {@see self::CACHE_SECONDS}); applying an update reads it fresh (#2150).
 */
final class HostingQuotaProbe
{
    public const CACHE_KEY = 'wgw.update.hosting_quota_free_bytes';

    public const CACHE_SECONDS = 300;

    public function __construct(private readonly string $command = 'quota -s 2>/dev/null') {}

    /** Runs the command now and stores the answer for the cached reads. */
    public function freeBytes(): ?int
    {
        $bytes = $this->read();
        try {
            Cache::put(self::CACHE_KEY, ['bytes' => $bytes], self::CACHE_SECONDS);
        } catch (\Throwable) {
            // A cache that cannot be written only costs the next poll a shell.
        }

        return $bytes;
    }

    /** The last answer if it is younger than {@see self::CACHE_SECONDS}, else a fresh one. */
    public function cachedFreeBytes(): ?int
    {
        try {
            $cached = Cache::get(self::CACHE_KEY);
        } catch (\Throwable) {
            $cached = null;
        }
        if (is_array($cached) && array_key_exists('bytes', $cached)) {
            $bytes = $cached['bytes'];

            return is_int($bytes) ? $bytes : null;
        }

        return $this->freeBytes();
    }

    private function read(): ?int
    {
        if (! function_exists('shell_exec')) {
            return null;
        }
        $output = @shell_exec($this->command);
        if (! is_string($output) || trim($output) === '') {
            return null;
        }

        return self::parseFreeBytes($output);
    }

    /** Free bytes under the first filesystem line of `quota -s` output that has a limit. */
    public static function parseFreeBytes(string $output): ?int
    {
        $lines = preg_split('/\R/', $output) ?: [];
        foreach ($lines as $line) {
            $trimmed = trim((string) $line);
            if ($trimmed === '' || $trimmed[0] !== '/') {
                continue;
            }
            $parts = preg_split('/\s+/', $trimmed) ?: [];
            if (count($parts) < 4) {
                continue;
            }
            $used = self::parseSizeToken($parts[1]);
            $quota = self::parseSizeToken($parts[2]);
            $limit = self::parseSizeToken($parts[3]);
            if (! is_int($used)) {
                continue;
            }
            $cap = max((int) ($limit ?? 0), (int) ($quota ?? 0));
            if ($cap <= 0) {
                continue;
            }

            return max(0, $cap - $used);
        }

        return null;
    }

    /** A size from `quota -s` (`1024`, `512M`, `2.5G*`) in bytes; bare numbers are KiB. */
    public static function parseSizeToken(string $token): ?int
    {
        $clean = rtrim(trim($token), '*');
        if ($clean === '' || $clean === '-' || strcasecmp($clean, 'none') === 0) {
            return null;
        }
        if (preg_match('/^([0-9]+(?:\.[0-9]+)?)([KMGTP]?)(?:i?B)?$/i', $clean, $m) !== 1) {
            if (preg_match('/^[0-9]+$/', $clean) === 1) {
                return (int) $clean * 1024;
            }

            return null;
        }
        $value = (float) $m[1];
        $unit = strtoupper($m[2]);
        $power = match ($unit) {
            'K' => 1,
            'M' => 2,
            'G' => 3,
            'T' => 4,
            'P' => 5,
            default => 0,
        };
        $bytes = (int) round($value * (1024 ** $power));

        return max(0, $bytes);
    }
}
