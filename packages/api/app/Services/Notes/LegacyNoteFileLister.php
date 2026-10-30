<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Storage\WgwStorage;
use DirectoryIterator;

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
     * One directory at a time, so a folder that cannot be opened is reported
     * and the walk goes on with its siblings.
     *
     * @param  list<string>  $notices
     * @return list<string>
     */
    private function walk(string $root, string $dir, array &$notices): array
    {
        $files = [];
        try {
            $entries = new DirectoryIterator($dir);
            foreach ($entries as $entry) {
                if ($entry->isDot()) {
                    continue;
                }
                $path = $entry->getPathname();
                if ($entry->isLink()) {
                    $notices[] = 'skipped symbolic link: '.$this->virtual($root, $path);
                } elseif ($entry->isDir()) {
                    array_push($files, ...$this->walk($root, $path, $notices));
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
