<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveStarredItem;
use App\Storage\StoragePaths;

final class DriveStarService
{
    public function __construct(private StoragePaths $paths) {}

    /**
     * @param  list<string>  $groupSlugs
     * @return list<string>
     */
    public function listPaths(string $username, array $groupSlugs): array
    {
        $rows = DriveStarredItem::query()
            ->where('username', $username)
            ->orderByDesc('created_at')
            ->pluck('path');

        $out = [];
        foreach ($rows as $path) {
            if (! is_string($path)) {
                continue;
            }
            $normalized = $this->paths->normalizeVirtualPath($path);
            if (! $this->paths->isPathAllowed($normalized, $username, $groupSlugs, false)) {
                continue;
            }
            if ($this->isHiddenBrowsePath($normalized)) {
                continue;
            }
            $out[] = $normalized;
        }

        return array_values(array_unique($out));
    }

    public function setStarred(string $username, string $path, bool $starred): void
    {
        $path = $this->paths->normalizeVirtualPath($path);
        if ($path === '/') {
            throw new \InvalidArgumentException('Cannot star root path.');
        }

        if ($starred) {
            DriveStarredItem::query()->updateOrInsert(
                ['username' => $username, 'path' => $path],
                ['created_at' => time()]
            );

            return;
        }

        DriveStarredItem::query()
            ->where('username', $username)
            ->where('path', $path)
            ->delete();
    }

    private function isHiddenBrowsePath(string $virtualPath): bool
    {
        return $this->isHiddenNotesPath($virtualPath)
            || DocAttachmentPaths::isHiddenBrowseVirtualPath($virtualPath);
    }

    private function isHiddenNotesPath(string $virtualPath): bool
    {
        return preg_match('#/(?:users|groups)/[^/]+/\.notes(?:/|$)#', $virtualPath) === 1;
    }
}
