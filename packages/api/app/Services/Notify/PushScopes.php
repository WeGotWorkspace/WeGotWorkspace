<?php

declare(strict_types=1);

namespace App\Services\Notify;

/**
 * Web Push scope per installed app (#1606).
 *
 * A scope is the `id` of one of the app's web manifests (`/`, `/docs`, …). The
 * client sends it with each subscribe: the manifest id in an iOS Home Screen
 * app (the only place where each app has its own subscription), `/` everywhere
 * else. A subscription keeps every scope it was posted from; `/` replaces them
 * all and receives every notification. A notification goes to `/` and to the
 * app whose scope holds the path it opens; for a notification that opens `/`,
 * to the app its domain maps to.
 *
 * Stored as a space-separated list in `push_subscriptions.scopes`. Null means
 * "unknown" (a row from before scopes, or a client that sent none): it
 * receives everything, and the first scope posted replaces it.
 */
final class PushScopes
{
    public const ROOT = '/';

    /** Manifest ids in `packages/apps/public/manifests`. */
    public const KNOWN = [
        '/',
        '/admin',
        '/calendar',
        '/contacts',
        '/docs',
        '/drive',
        '/meet',
        '/notes',
        '/settings',
        '/tasks',
    ];

    /** Notification domain → its app, for notifications that open the suite start. */
    private const DOMAIN_SCOPES = [
        'docs' => '/docs',
        'calendar' => '/calendar',
        'tasks' => '/tasks',
        'notes' => '/notes',
        'chat' => '/meet',
        'meet' => '/meet',
    ];

    public static function forDomain(string $domain): ?string
    {
        return self::DOMAIN_SCOPES[$domain] ?? null;
    }

    /**
     * @param  list<string>|null  $stored
     * @return list<string>|null
     */
    public static function merge(?array $stored, ?string $incoming): ?array
    {
        if ($incoming === null) {
            return $stored;
        }
        $scopes = array_values(array_unique([...($stored ?? []), $incoming]));
        if (in_array(self::ROOT, $scopes, true)) {
            return [self::ROOT];
        }
        sort($scopes);

        return $scopes;
    }

    /**
     * The app (not `/`) that opens `$navigate`: the longest manifest scope that
     * holds it, or for `/` the app of `$domain`. Null when only the suite does.
     */
    public static function target(string $navigate, string $domain): ?string
    {
        $path = self::normalizePath($navigate);
        if (substr($path, 0, strcspn($path, '?#')) === self::ROOT) {
            return self::forDomain($domain);
        }
        $best = null;
        foreach (self::KNOWN as $scope) {
            if ($scope !== self::ROOT && strlen($scope) > strlen($best ?? '') && self::within($path, $scope)) {
                $best = $scope;
            }
        }

        return $best;
    }

    /**
     * The scope a subscription receives a notification for `$target` (see
     * {@see target()}) under, or null when it does not receive it.
     *
     * @param  list<string>|null  $scopes
     */
    public static function receiving(?array $scopes, ?string $target): ?string
    {
        if ($scopes === null || in_array(self::ROOT, $scopes, true)) {
            return self::ROOT;
        }

        return $target !== null && in_array($target, $scopes, true) ? $target : null;
    }

    /**
     * Keep `$path` when it opens inside the app; otherwise open the app's start.
     * `$path` is normalised first (see {@see normalizePath()}).
     */
    public static function navigateWithin(string $path, string $scope): string
    {
        $path = self::normalizePath($path);

        return self::within($path, $scope) ? $path : $scope;
    }

    /**
     * `$path` as a browser opens it: dot segments resolved (also `%2e`), `\`
     * read as `/`. Anything that is not a same-origin path becomes `/`.
     */
    public static function normalizePath(string $path): string
    {
        if (! str_starts_with($path, '/') && ! str_starts_with($path, '\\')) {
            return self::ROOT;
        }
        $cut = strcspn($path, '?#');
        $rest = substr($path, $cut);
        $segments = explode('/', str_replace('\\', '/', substr($path, 1, max(0, $cut - 1))));
        $out = [];
        $last = count($segments) - 1;
        foreach ($segments as $i => $segment) {
            $lower = strtolower($segment);
            $dot = in_array($lower, ['.', '%2e'], true);
            $dotDot = in_array($lower, ['..', '.%2e', '%2e.', '%2e%2e'], true);
            if ($dotDot) {
                array_pop($out);
            }
            if ($dot || $dotDot) {
                if ($i === $last) {
                    $out[] = '';
                }

                continue;
            }
            $out[] = $segment;
        }
        $normalized = '/'.implode('/', $out);

        return str_starts_with($normalized, '//') ? self::ROOT : $normalized.$rest;
    }

    private static function within(string $path, string $scope): bool
    {
        if ($scope === self::ROOT || $path === $scope) {
            return true;
        }

        return str_starts_with($path, $scope) && in_array(substr($path, strlen($scope), 1), ['/', '?', '#'], true);
    }

    /**
     * @return list<string>|null
     */
    public static function decode(?string $column): ?array
    {
        if ($column === null || trim($column) === '') {
            return null;
        }
        $scopes = array_values(array_filter(
            explode(' ', $column),
            static fn (string $scope): bool => in_array($scope, self::KNOWN, true),
        ));

        return $scopes === [] ? null : $scopes;
    }

    /**
     * @param  list<string>|null  $scopes
     */
    public static function encode(?array $scopes): ?string
    {
        return $scopes === null ? null : implode(' ', $scopes);
    }
}
