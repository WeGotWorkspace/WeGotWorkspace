<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Storage\WgwStorage;
use DirectoryIterator;

/**
 * Lists the files under every personal and group `.notes` tree (v0.1.96 and
 * older), and only there: walking the whole Drive would make the update slow.
 *
 * It walks the local disk itself, one directory at a time, because
 * Flysystem's listing throws on the first symbolic link or unreadable
 * folder, which would stop the import for every note. A link or a folder
 * that cannot be opened is skipped with a notice that names it, and its
 * siblings are still listed (#1773). The update does not retry those notes on
 * its own; the update log tells the admin to run `wgw:notes:migrate-files`
 * once the folder is readable.
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
     * One directory at a time, so a folder that cannot be opened is named
     * and skipped while its siblings are still listed.
     *
     * @param  list<string>  $notices
     * @return list<string>
     */
    private function walk(string $root, string $dir, array &$notices): array
    {
        try {
            $entries = new DirectoryIterator($dir);
        } catch (\Throwable $e) {
            $notices[] = 'could not list '.$this->virtual($root, $dir).': '.$e->getMessage();

            return [];
        }
        $files = [];
        $subdirs = [];
        foreach ($entries as $entry) {
            if ($entry->isDot()) {
                continue;
            }
            $path = $entry->getPathname();
            if ($entry->isLink()) {
                $notices[] = 'skipped symbolic link: '.$this->virtual($root, $path);
            } elseif ($entry->isDir()) {
                $subdirs[] = $path;
            } elseif ($entry->isFile()) {
                $files[] = substr($path, strlen($root) + 1);
            }
        }
        foreach ($subdirs as $subdir) {
            array_push($files, ...$this->walk($root, $subdir, $notices));
        }

        return $files;
    }

    private function virtual(string $root, string $path): string
    {
        return substr($path, strlen($root));
    }
}
