<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Storage\WgwStorage;
use FilesystemIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;

/**
 * Lists the files under every personal and group `.notes` tree (v0.1.96 and
 * older), and only there: walking the whole Drive would make the update slow.
 *
 * It walks the local disk itself because Flysystem's listing throws on the
 * first symbolic link or unreadable folder, which would stop the import for
 * every note. Those entries are skipped with a notice instead (#1773).
 */
final class LegacyNoteFileLister
{
    public function __construct(private readonly WgwStorage $storage) {}

    /**
     * @param  list<string>  $notices
     * @return list<string> Storage keys relative to the files disk root.
     */
    public function list(array &$notices): array
    {
        $root = rtrim($this->storage->files()->path(''), '/');
        $files = [];
        foreach (['users', 'groups'] as $scope) {
            foreach (glob($root.'/'.$scope.'/*/.notes', GLOB_ONLYDIR | GLOB_NOSORT) ?: [] as $notesDir) {
                if (is_link($notesDir) || is_link(dirname($notesDir))) {
                    $notices[] = 'skipped symbolic link: '.$this->virtual($root, $notesDir);

                    continue;
                }
                array_push($files, ...$this->walk($root, $notesDir, $notices));
            }
        }
        sort($files);

        return $files;
    }

    /**
     * @param  list<string>  $notices
     * @return list<string>
     */
    private function walk(string $root, string $dir, array &$notices): array
    {
        $files = [];
        try {
            $entries = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
                RecursiveIteratorIterator::SELF_FIRST,
                RecursiveIteratorIterator::CATCH_GET_CHILD,
            );
            /** @var SplFileInfo $entry */
            foreach ($entries as $entry) {
                $path = $entry->getPathname();
                if ($entry->isLink()) {
                    $notices[] = 'skipped symbolic link: '.$this->virtual($root, $path);
                } elseif ($entry->isFile()) {
                    $files[] = substr($path, strlen($root) + 1);
                }
            }
        } catch (\Throwable $e) {
            $notices[] = 'could not list '.$this->virtual($root, $dir).': '.$e->getMessage();
        }

        return $files;
    }

    private function virtual(string $root, string $path): string
    {
        return substr($path, strlen($root));
    }
}
