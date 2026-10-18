<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\AppPaths;
use App\Support\WebRootDeny;

/**
 * Removes `<install root>/wgw-content` when the data directory lives elsewhere
 * and that folder holds only files an earlier boot generated there.
 *
 * Before #1329 was fixed, the first request to a fresh ZIP tree wrote an OAuth
 * key pair into the stock `./wgw-content`, and the install then added deny
 * files beside it. Passport loads from the resolved data directory only, so
 * that pair is never live. Anything outside the allowlist leaves the folder
 * untouched.
 */
final class StrayDataDirCleaner
{
    private const KEY_FILES = ['oauth-private.key', 'oauth-public.key'];

    public function __construct(private AppPaths $paths) {}

    public function removeIfStray(): bool
    {
        $candidate = rtrim($this->paths->installRoot(), '/').'/wgw-content';
        if (is_link($candidate) || ! is_dir($candidate)) {
            return false;
        }

        $strayReal = realpath($candidate);
        $dataReal = realpath($this->paths->dataDir());
        if ($strayReal === false || $dataReal === false) {
            return false;
        }
        if ($dataReal === $strayReal || str_starts_with($dataReal, $strayReal.'/')) {
            return false;
        }

        $files = $this->allowlistedFiles($strayReal);
        if ($files === null) {
            return false;
        }

        foreach ($files as $file) {
            if (! @unlink($file)) {
                return false;
            }
        }
        if (is_dir($strayReal.'/keys')) {
            @rmdir($strayReal.'/keys');
        }

        return @rmdir($strayReal);
    }

    /**
     * @return list<string>|null every file to remove, or null when anything is not allowlisted
     */
    private function allowlistedFiles(string $dir): ?array
    {
        $entries = $this->entries($dir);
        if ($entries === null) {
            return null;
        }

        $files = [];
        foreach ($entries as $entry) {
            $path = $dir.'/'.$entry;
            if ($entry === 'keys') {
                $keys = $this->keyFiles($path);
                if ($keys === null) {
                    return null;
                }
                array_push($files, ...$keys);

                continue;
            }

            $expected = match ($entry) {
                '.htaccess' => WebRootDeny::HTACCESS,
                '.probe' => WebRootDeny::PROBE,
                default => null,
            };
            if ($expected === null || ! $this->isPlainFile($path) || @file_get_contents($path) !== $expected) {
                return null;
            }
            $files[] = $path;
        }

        return $files;
    }

    /**
     * @return list<string>|null
     */
    private function keyFiles(string $dir): ?array
    {
        if (is_link($dir) || ! is_dir($dir)) {
            return null;
        }

        $entries = $this->entries($dir);
        if ($entries === null) {
            return null;
        }

        $files = [];
        foreach ($entries as $entry) {
            $path = $dir.'/'.$entry;
            if (! in_array($entry, self::KEY_FILES, true) || ! $this->isPlainFile($path)) {
                return null;
            }
            $files[] = $path;
        }

        return $files;
    }

    private function isPlainFile(string $path): bool
    {
        return ! is_link($path) && is_file($path);
    }

    /**
     * @return list<string>|null
     */
    private function entries(string $dir): ?array
    {
        $items = @scandir($dir);
        if ($items === false) {
            return null;
        }

        return array_values(array_filter($items, static fn (string $item): bool => $item !== '.' && $item !== '..'));
    }
}
