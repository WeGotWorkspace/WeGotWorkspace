<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The browser traffic budget from `config('wgw.traffic')`: a profile with
 * per-number overrides. Rendered into the `X-WGW-Traffic-Budget` header that
 * the service worker's request governor reads (packages/apps/src/lib/traffic).
 */
final class TrafficBudget
{
    public const HEADER = 'X-WGW-Traffic-Budget';

    /** @var array<string, array{background: int, bulk: int, burst: int}> */
    private const PROFILES = [
        // A shared host's firewall may block an IP above about 60 requests a minute.
        'shared' => ['background' => 30, 'bulk' => 20, 'burst' => 10],
        'standard' => ['background' => 120, 'bulk' => 120, 'burst' => 30],
        'off' => ['background' => 0, 'bulk' => 0, 'burst' => 0],
    ];

    /** @return array{background: int, bulk: int, burst: int} 0 means unpaced */
    public static function current(): array
    {
        $config = (array) config('wgw.traffic', []);
        $profile = self::PROFILES[strtolower(trim((string) ($config['profile'] ?? 'shared')))] ?? self::PROFILES['shared'];

        return [
            'background' => self::number($config['background_per_minute'] ?? null, $profile['background']),
            'bulk' => self::number($config['bulk_per_minute'] ?? null, $profile['bulk']),
            'burst' => self::number($config['burst'] ?? null, $profile['burst']),
        ];
    }

    public static function header(): string
    {
        $budget = self::current();

        return 'background='.$budget['background'].'; bulk='.$budget['bulk'].'; burst='.$budget['burst'];
    }

    private static function number(mixed $value, int $fallback): int
    {
        if ($value === null || $value === '' || ! is_numeric($value)) {
            return $fallback;
        }

        return max(0, min(10_000, (int) $value));
    }
}
