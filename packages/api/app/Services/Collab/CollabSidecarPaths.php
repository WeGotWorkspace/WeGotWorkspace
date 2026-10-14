<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Storage\StoragePaths;

/**
 * Hidden collab Yjs sidecar next to a document: `.{name}.yjs`.
 *
 * Recognized by its own name, not by the document extension, so both
 * markdown sidecars and the wider collab extension set are covered.
 * Listings hide it and mutations are rejected. A direct read of a known path stays allowed.
 */
final class CollabSidecarPaths
{
    public const SUFFIX = '.yjs';

    /** `.together.md.yjs` → true; `together.md` and `notes.yjs` → false. */
    public static function isSidecarName(string $name): bool
    {
        return preg_match('/^\\..+'.preg_quote(self::SUFFIX, '/').'$/', $name) === 1;
    }

    /** Any `files/(users|groups)/…/.x.yjs` DAV path. */
    public static function davIsProtected(string $davPath): bool
    {
        $path = trim(str_replace('\\', '/', $davPath), '/');
        if (preg_match('#^files/(users|groups)/[^/]+/#', $path) !== 1) {
            return false;
        }

        return self::isSidecarName(basename($path));
    }

    /** `/users/alice/docs/together.md` → `/users/alice/docs/.together.md.yjs`. */
    public static function sidecarVirtualPath(StoragePaths $paths, string $documentVirtualPath): string
    {
        $normalized = $paths->normalizeVirtualPath($documentVirtualPath);
        $dir = (string) dirname($normalized);
        $name = (string) basename($normalized);
        $hidden = '.'.$name.'.yjs';
        $prefix = $dir === '/' ? '' : $dir;

        return $paths->normalizeVirtualPath($prefix.'/'.$hidden);
    }

    public static function isHiddenBrowseVirtualPath(string $virtualPath): bool
    {
        return self::isSidecarName(basename(trim(str_replace('\\', '/', $virtualPath), '/')));
    }
}
