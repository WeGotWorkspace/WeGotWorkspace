<?php

declare(strict_types=1);

namespace App\Services\Drive;

use Illuminate\Contracts\Filesystem\Filesystem;

/**
 * Collision names for product trash (`{base} {n}{ext}`), shared by REST rename
 * and grantee FileNode/set destroy (#990).
 */
final class DriveTrashNames
{
    public function isTrashDestination(string $virtualPath): bool
    {
        return preg_match('#/\.Trash$#', $virtualPath) === 1
            || preg_match('#/Trash$#', $virtualPath) === 1;
    }

    public function unique(Filesystem $disk, string $trashStorageKey, string $name): string
    {
        $name = $this->validateItemName($name);
        $taken = [];
        foreach ($disk->files($trashStorageKey) as $key) {
            $taken[] = basename($key);
        }
        foreach ($disk->directories($trashStorageKey) as $key) {
            $taken[] = basename($key);
        }
        $takenLower = array_map(static fn (string $entry): string => mb_strtolower($entry), $taken);

        $dot = strrpos($name, '.');
        $hasExt = $dot !== false && $dot > 0;
        $base = $hasExt ? substr($name, 0, $dot) : $name;
        $ext = $hasExt ? substr($name, $dot) : '';

        $candidate = $name;
        $index = 2;
        while (in_array(mb_strtolower($candidate), $takenLower, true)) {
            $candidate = $base.' '.$index.$ext;
            $index++;
        }

        return $candidate;
    }

    private function validateItemName(string $name): string
    {
        $name = trim($name);
        if (
            $name === ''
            || $name === '.'
            || $name === '..'
            || str_contains($name, '/')
            || str_contains($name, '\\')
            || str_contains($name, "\0")
        ) {
            throw new \InvalidArgumentException('Invalid item name.');
        }

        return $name;
    }
}
