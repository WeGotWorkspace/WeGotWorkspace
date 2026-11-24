<?php

declare(strict_types=1);

namespace App\Storage;

/**
 * The server-owned tree that holds the folders of archived Projects (#819 B2):
 * `groups/{team}/.project-archive/{project slug}`.
 *
 * It stays in the file index, so the folder keeps its FileNode ids and comes back with
 * them on unarchive. No client request may list, open, search, write or share anything
 * under it, and grants on paths under it are inert. Only the Projects services move
 * folders in and out.
 */
final class ProjectArchivePaths
{
    public const DIR = '.project-archive';

    private const PATTERN = '#^/?groups/[^/]+/\.project-archive(/|$)#';

    /** The storage key of an archived Project's folder. */
    public static function keyFor(string $teamSlug, string $projectSlug): string
    {
        return 'groups/'.$teamSlug.'/'.self::DIR.'/'.$projectSlug;
    }

    /** A storage key (`groups/t1/…`) or a virtual path (`/groups/t1/…`) at or under the tree. */
    public static function isUnder(string $keyOrPath): bool
    {
        return preg_match(self::PATTERN, str_replace('\\', '/', $keyOrPath)) === 1;
    }

    /** A DAV path (`files/groups/t1/…`, with or without a leading slash) at or under the tree. */
    public static function davIsProtected(string $davPath): bool
    {
        $path = ltrim((string) preg_replace('#/+#', '/', str_replace('\\', '/', $davPath)), '/');

        return str_starts_with($path, 'files/') && self::isUnder(substr($path, strlen('files/')));
    }
}
