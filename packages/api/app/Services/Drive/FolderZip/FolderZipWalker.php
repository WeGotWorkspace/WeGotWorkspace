<?php

declare(strict_types=1);

namespace App\Services\Drive\FolderZip;

use App\Models\JmapFileNode;
use App\Services\Jmap\FileNodes\FileNodeIndexService;

/**
 * Walks a Drive folder for its zip (#1621), depth-first over the node index,
 * and yields what the caller sees in Drive:
 *
 *  - every readable subfolder, empty ones included, before its contents
 *  - every readable file
 *  - nothing whose name starts with `.` (trash, notes, Doc attachments, Yjs
 *    sidecars, other hidden names), with its subtree
 *  - no tombstoned rows; an unreadable folder is left out with its subtree
 *
 * Each directory is reconciled with the disk first, as FileNode/query does.
 * Children load in chunks, so a large directory is never held at once.
 *
 * Entry paths start with the folder's own name and are safe for any
 * extractor: separators and control characters become `_`, and names that
 * collide case-insensitively in one folder get ` (2)`, ` (3)`, ….
 */
final class FolderZipWalker
{
    private const CHILD_CHUNK = 200;

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FolderZipReadCheck $reads,
    ) {}

    /**
     * @param  array{username: string, role: string}  $principal
     * @return \Generator<int, array{directory: bool, path: string, key: string}>
     */
    public function entries(JmapFileNode $folder, array $principal): \Generator
    {
        $top = self::safeName((string) $folder->name);
        yield ['directory' => true, 'path' => $top, 'key' => (string) $folder->storage_key];
        yield from $this->children($folder, $top, $principal);
    }

    /** The zip's top folder and download name stem: the folder's own name, made safe. */
    public static function safeName(string $name): string
    {
        $name = trim((string) preg_replace('/[\x00-\x1f\x7f\/\\\\]/u', '_', mb_scrub($name, 'UTF-8')));

        return in_array($name, ['', '.', '..'], true) ? '_' : $name;
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return \Generator<int, array{directory: bool, path: string, key: string}>
     */
    private function children(JmapFileNode $dir, string $path, array $principal): \Generator
    {
        $this->index->reconcileDirectory((string) $dir->storage_key);
        $used = [];
        $children = JmapFileNode::query()
            ->where('parent_node_id', (string) $dir->node_id)
            ->whereNull('deleted_at')
            ->lazyById(self::CHILD_CHUNK);

        foreach ($children as $child) {
            $name = (string) $child->name;
            if (str_starts_with($name, '.')) {
                continue;
            }
            $key = (string) $child->storage_key;
            if (! $this->reads->mayRead($key, $principal)) {
                continue;
            }
            $childPath = $path.'/'.self::uniqueName(self::safeName($name), (bool) $child->is_dir, $used);
            if ($child->is_dir) {
                yield ['directory' => true, 'path' => $childPath, 'key' => $key];
                yield from $this->children($child, $childPath, $principal);
            } else {
                yield ['directory' => false, 'path' => $childPath, 'key' => $key];
            }
        }
    }

    /**
     * @param  array<string, true>  $used  lower-cased names already in this folder
     */
    public static function uniqueName(string $name, bool $isDirectory, array &$used): string
    {
        $stem = $name;
        $extension = '';
        $dot = strrpos($name, '.');
        if (! $isDirectory && $dot !== false && $dot > 0) {
            $stem = substr($name, 0, $dot);
            $extension = substr($name, $dot);
        }
        $candidate = $name;
        for ($n = 2; isset($used[mb_strtolower($candidate)]); $n++) {
            $candidate = $stem.' ('.$n.')'.$extension;
        }
        $used[mb_strtolower($candidate)] = true;

        return $candidate;
    }
}
