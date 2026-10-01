<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveStarredItem;
use App\Storage\StoragePaths;
use Illuminate\Database\Eloquent\Collection;

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

    /**
     * Move star rows at $fromPath, and any nested under it, onto $toPath.
     *
     * Rows already at the destination that are not part of this move are
     * removed first, so a leftover row cannot attach to the item that now
     * occupies that path. created_at stays with the row that moved.
     *
     * @return int number of star rows moved
     */
    public function rewritePathPrefix(string $fromPath, string $toPath): int
    {
        $from = $this->paths->normalizeVirtualPath($fromPath);
        $to = $this->paths->normalizeVirtualPath($toPath);
        if ($from === '/' || $to === '/' || $from === $to) {
            return 0;
        }

        return (int) DriveStarredItem::query()->getConnection()->transaction(function () use ($from, $to): int {
            $sourceRows = $this->lockedRowsUnderPrefix($from);
            $destRows = $this->lockedRowsUnderPrefix($to);

            /** @var array<string, array{username: string, path: string, created_at: int}> $pending */
            $pending = [];
            /** @var array<string, array{0: string, 1: string}> $deleteKeys */
            $deleteKeys = [];

            foreach ($sourceRows as $row) {
                $stored = (string) $row->path;
                $old = $this->paths->normalizeVirtualPath($stored);
                $new = $old === $from ? $to : $to.substr($old, strlen($from));
                $username = (string) $row->username;
                $deleteKeys[$username."\0".$stored] = [$username, $stored];
                $pending[$username."\0".$new] = [
                    'username' => $username,
                    'path' => $new,
                    'created_at' => (int) $row->created_at,
                ];
            }

            foreach ($destRows as $row) {
                $stored = (string) $row->path;
                $old = $this->paths->normalizeVirtualPath($stored);
                if ($this->pathIsUnderPrefix($old, $from)) {
                    continue;
                }
                $username = (string) $row->username;
                $deleteKeys[$username."\0".$stored] = [$username, $stored];
            }

            foreach ($deleteKeys as [$username, $stored]) {
                DriveStarredItem::query()
                    ->where('username', $username)
                    ->where('path', $stored)
                    ->delete();
            }

            if ($pending !== []) {
                DriveStarredItem::query()->insert(array_values($pending));
            }

            return count($pending);
        });
    }

    /**
     * Remove star rows at $path and anything nested under it, for every user.
     *
     * @return int number of star rows removed
     */
    public function deletePathPrefix(string $path): int
    {
        $path = $this->paths->normalizeVirtualPath($path);
        if ($path === '/') {
            return 0;
        }

        return (int) DriveStarredItem::query()->getConnection()->transaction(function () use ($path): int {
            $rows = $this->lockedRowsUnderPrefix($path);
            foreach ($rows as $row) {
                DriveStarredItem::query()
                    ->where('username', (string) $row->username)
                    ->where('path', (string) $row->path)
                    ->delete();
            }

            return count($rows);
        });
    }

    /**
     * LIKE is a coarse filter (`_` / `%` are wildcards); path boundaries are authoritative.
     *
     * @return list<DriveStarredItem>
     */
    private function lockedRowsUnderPrefix(string $prefix): array
    {
        /** @var Collection<int, DriveStarredItem> $rows */
        $rows = DriveStarredItem::query()
            ->where(function ($query) use ($prefix): void {
                $query->where('path', $prefix)
                    ->orWhere('path', 'like', $prefix.'/%');
            })
            ->lockForUpdate()
            ->get();

        $matched = [];
        foreach ($rows as $row) {
            $path = $this->paths->normalizeVirtualPath((string) $row->path);
            if ($this->pathIsUnderPrefix($path, $prefix)) {
                $matched[] = $row;
            }
        }

        return $matched;
    }

    private function pathIsUnderPrefix(string $path, string $prefix): bool
    {
        return $path === $prefix || str_starts_with($path, $prefix.'/');
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
