<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;

/**
 * Public origin from APP_URL, plus the installed base path.
 *
 * A loopback APP_URL is treated as unset: Host checks stay off and
 * password-reset mail is not sent.
 */
final class PublicAppUrl
{
    /** @var list<string> */
    private const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

    public static function isConfigured(): bool
    {
        return self::configuredHost() !== null;
    }

    /**
     * Trusted-host patterns. An empty list means no Host restriction.
     *
     * @return list<string>
     */
    public static function trustedHostPatterns(): array
    {
        $host = self::configuredHost();
        if ($host === null) {
            return [];
        }

        $hosts = array_merge([$host], self::LOOPBACK_HOSTS, self::extraHosts());
        $unique = [];
        foreach ($hosts as $candidate) {
            if (! in_array($candidate, $unique, true)) {
                $unique[] = $candidate;
            }
        }

        return array_map(
            static fn (string $trusted): string => '^'.preg_quote($trusted).'$',
            $unique,
        );
    }

    public static function to(string $path): string
    {
        $configured = (string) config('app.url');
        $parts = parse_url($configured);
        $scheme = is_array($parts) && is_string($parts['scheme'] ?? null) && $parts['scheme'] !== ''
            ? $parts['scheme']
            : 'http';
        $host = is_array($parts) && is_string($parts['host'] ?? null) ? $parts['host'] : '';
        $port = is_array($parts) && isset($parts['port']) ? ':'.$parts['port'] : '';
        $origin = $host !== '' ? $scheme.'://'.$host.$port : rtrim($configured, '/');
        $base = self::basePath();
        $prefix = $base === '/' ? '' : rtrim($base, '/');

        return $origin.$prefix.'/'.ltrim($path, '/');
    }

    private static function configuredHost(): ?string
    {
        $host = parse_url((string) config('app.url'), PHP_URL_HOST);
        if (! is_string($host) || $host === '') {
            return null;
        }
        $host = strtolower($host);
        if (in_array($host, self::LOOPBACK_HOSTS, true)) {
            return null;
        }

        return $host;
    }

    /**
     * @return list<string>
     */
    private static function extraHosts(): array
    {
        $raw = config('wgw.trusted_hosts');
        if (! is_string($raw) || trim($raw) === '') {
            $fromEnv = getenv('WGW_TRUSTED_HOSTS');
            $raw = is_string($fromEnv) ? $fromEnv : '';
        }

        $hosts = [];
        foreach (preg_split('/\s*,\s*/', $raw) ?: [] as $piece) {
            $piece = strtolower(trim($piece));
            if ($piece === '' || str_contains($piece, '/') || str_contains($piece, ' ')) {
                continue;
            }
            $hosts[] = $piece;
        }

        return $hosts;
    }

    private static function basePath(): string
    {
        try {
            $stored = AppSetting::getValue(SettingKeys::BASE_URI, null);
        } catch (\Throwable) {
            $stored = null;
        }
        if (! is_string($stored) || trim($stored) === '') {
            $fromEnv = config('wgw.install.base_uri');
            $stored = is_string($fromEnv) ? $fromEnv : '/';
        }

        $uri = trim($stored);
        if ($uri === '' || $uri === '/') {
            return '/';
        }
        if ($uri[0] !== '/') {
            $uri = '/'.$uri;
        }

        return rtrim($uri, '/').'/';
    }
}
