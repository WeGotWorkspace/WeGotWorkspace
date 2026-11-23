<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Admin\AdminConstants;

/**
 * Name of a Team collection inside a member's own CalDAV or CardDAV home (#2158).
 *
 * Native apps only look in the signed-in person's home, so each Team collection
 * also shows up there as `team~{slug}~{uri}`. Team slugs never contain `~`, so the
 * name parses back unambiguously, and a member's own collections may not start
 * with the prefix (MKCALENDAR / MKCOL refuse it), so the names never collide.
 *
 * The canonical path of the same collection is `{tree}/groups/{slug}/{uri}`, the
 * path the web app and the server-side hooks already use for Team collections.
 */
final class TeamCollectionName
{
    public const PREFIX = 'team~';

    private const SEPARATOR = '~';

    public static function make(string $slug, string $uri): string
    {
        return self::PREFIX.$slug.self::SEPARATOR.$uri;
    }

    public static function isReserved(string $name): bool
    {
        return str_starts_with($name, self::PREFIX);
    }

    /**
     * @return array{slug: string, uri: string}|null
     */
    public static function parse(string $name): ?array
    {
        if (! self::isReserved($name)) {
            return null;
        }
        $rest = substr($name, strlen(self::PREFIX));
        $at = strpos($rest, self::SEPARATOR);
        if ($at === false || $at === 0 || $at === strlen($rest) - 1) {
            return null;
        }

        return ['slug' => substr($rest, 0, $at), 'uri' => substr($rest, $at + 1)];
    }

    /**
     * `calendars/{user}/team~{slug}~{uri}/…` => `calendars/groups/{slug}/{uri}/…`, and the
     * same for `addressbooks/`. Any other path comes back unchanged.
     */
    public static function canonicalPath(string $path): string
    {
        $trimmed = trim($path, '/');
        $segments = explode('/', $trimmed);
        if (count($segments) < 3 || ! in_array($segments[0], ['calendars', 'addressbooks'], true)) {
            return $path;
        }
        $parsed = self::parse($segments[2]);
        if ($parsed === null) {
            return $path;
        }
        [, $groups] = explode('/', rtrim(AdminConstants::GROUP_CONTAINER_URI, '/'), 2);
        array_splice($segments, 1, 2, [$groups, $parsed['slug'], $parsed['uri']]);

        return implode('/', $segments);
    }
}
