<?php

declare(strict_types=1);

namespace App\Services\Notify;

/**
 * Web Push scope per installed app (#1606).
 *
 * A scope is the `id` of one of the app's web manifests (`/`, `/docs`, …). The
 * client sends it with each subscribe: the manifest id when it runs as an
 * installed app, `/` in a browser tab or the suite PWA. A subscription keeps
 * every scope it was posted from; `/` replaces them all and receives every
 * notification. A notification goes to `/` and to the app its domain maps to.
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

    /** Notification domain → the installed app that alerts about it. */
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
     * The scope a subscription receives this notification under, or null when it
     * does not receive it.
     *
     * @param  list<string>|null  $scopes
     */
    public static function receiving(?array $scopes, string $domain): ?string
    {
        if ($scopes === null || in_array(self::ROOT, $scopes, true)) {
            return self::ROOT;
        }
        $scope = self::forDomain($domain);

        return $scope !== null && in_array($scope, $scopes, true) ? $scope : null;
    }

    /**
     * Keep `$path` when it opens inside the app; otherwise open the app's start.
     */
    public static function navigateWithin(string $path, string $scope): string
    {
        if ($scope === self::ROOT || $path === $scope) {
            return $path;
        }
        $next = substr($path, strlen($scope), 1);

        return str_starts_with($path, $scope) && in_array($next, ['/', '?', '#'], true) ? $path : $scope;
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
