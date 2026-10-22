<?php

declare(strict_types=1);

namespace App\Services\Jmap\Quota;

/**
 * Quota state without storage: the encoded map of quota id → fingerprint of
 * (used, hardLimit, name). Quota/changes decodes the client's sinceState and
 * compares it with the current map, so changes are exact for the handful of
 * quotas an account has.
 */
final class QuotaStateCodec
{
    private const PREFIX = 'q1.';

    /**
     * @param  list<array<string, mixed>>  $quotas
     * @return array<string, string>
     */
    public static function fingerprints(array $quotas): array
    {
        $map = [];
        foreach ($quotas as $quota) {
            $map[(string) $quota['id']] = substr(hash('sha256', implode('|', [
                (string) $quota['used'],
                (string) $quota['hardLimit'],
                (string) $quota['name'],
            ])), 0, 10);
        }
        ksort($map);

        return $map;
    }

    /**
     * @param  array<string, string>  $map
     */
    public static function encode(array $map): string
    {
        ksort($map);
        $json = json_encode((object) $map, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

        return self::PREFIX.rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }

    /**
     * @return array<string, string>|null null = not a state this server issued
     */
    public static function decode(string $state): ?array
    {
        if (! str_starts_with($state, self::PREFIX)) {
            return null;
        }
        $raw = base64_decode(strtr(substr($state, strlen(self::PREFIX)), '-_', '+/'), true);
        if ($raw === false) {
            return null;
        }
        $decoded = json_decode($raw, true);
        if (! is_array($decoded)) {
            return null;
        }
        $map = [];
        foreach ($decoded as $id => $fingerprint) {
            if (! is_string($id) || ! is_string($fingerprint)) {
                return null;
            }
            $map[$id] = $fingerprint;
        }

        return $map;
    }
}
