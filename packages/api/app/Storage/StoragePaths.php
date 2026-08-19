<?php

declare(strict_types=1);

namespace App\Storage;

/**
 * Virtual drive paths (/users/…, /groups/…) mapped to Flysystem keys under wgw_files.
 */
final class StoragePaths
{
    public function normalizeVirtualPath(string $path): string
    {
        $path = str_replace('\\', '/', trim($path));
        if ($path === '') {
            return '/';
        }
        if ($path[0] !== '/') {
            $path = '/'.$path;
        }
        $parts = [];
        foreach (explode('/', $path) as $part) {
            if ($part === '' || $part === '.') {
                continue;
            }
            if ($part === '..') {
                return '/';
            }
            $parts[] = $part;
        }

        return $parts === [] ? '/' : '/'.implode('/', $parts);
    }

    public function virtualToStorageKey(string $virtualPath): string
    {
        return ltrim($this->normalizeVirtualPath($virtualPath), '/');
    }

    public function noteStorageKey(string $username, string $relativePath): string
    {
        $relativePath = ltrim(str_replace('\\', '/', $relativePath), '/');

        return 'users/'.$username.'/.notes/'.$relativePath;
    }

    public function groupNoteStorageKey(string $slug, string $relativePath): string
    {
        $relativePath = ltrim(str_replace('\\', '/', $relativePath), '/');

        return 'groups/'.$slug.'/.notes/'.$relativePath;
    }

    /**
     * True when the virtual path lives inside a personal or group `.notes` tree.
     */
    public function isNotePath(string $path): bool
    {
        $normalized = $this->normalizeVirtualPath($path);

        return preg_match('#^/(?:users|groups)/[^/]+/\.notes(?:/|$)#', $normalized) === 1;
    }

    /**
     * Archived notes live under `…/.notes/.archive/…` (not other `.archive` dirs).
     */
    public function isNotesArchivePath(string $path): bool
    {
        return str_contains($this->normalizeVirtualPath($path), '/.notes/.archive/');
    }

    /**
     * Notebook directory for a note file storage key (parent dir). Empty when
     * the file sits directly under `.notes` or `.notes/.archive`.
     */
    public function noteNotebookFromKey(string $key): string
    {
        $virtual = $this->normalizeVirtualPath('/'.ltrim($key, '/'));
        if (! $this->isNotePath($virtual)) {
            return '';
        }
        if (preg_match('#/\.notes/\.archive/([^/]+)/[^/]+$#', $virtual, $matches) === 1) {
            return $matches[1];
        }
        if (preg_match('#/\.notes/([^/]+)/[^/]+$#', $virtual, $matches) === 1 && $matches[1] !== '.archive') {
            return $matches[1];
        }

        return '';
    }

    public function isPathAllowed(string $path, string $username, array $groupSlugs, bool $forWrite): bool
    {
        $normalized = $this->normalizeVirtualPath($path);
        if ($normalized === '/') {
            return true;
        }

        $segments = explode('/', ltrim($normalized, '/'));
        $first = $segments[0] ?? '';
        if ($first === 'users') {
            if (count($segments) === 1) {
                return ! $forWrite;
            }

            return strcasecmp((string) ($segments[1] ?? ''), $username) === 0;
        }

        if ($first === 'groups') {
            if (count($segments) === 1) {
                return ! $forWrite;
            }
            $slug = (string) ($segments[1] ?? '');

            return in_array($slug, $groupSlugs, true);
        }

        return false;
    }
}
