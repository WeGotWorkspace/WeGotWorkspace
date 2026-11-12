<?php

declare(strict_types=1);

namespace App\Services\Update;

/**
 * Keeps install-local files under packages/api that are not shipped in release ZIPs.
 */
final class ApiPackageLocalPreservation
{
    /** @var list<string> */
    private const PRESERVE_FILES = [
        '.env',
        // Names the .env kept outside the published tree (#1484).
        '.env.path',
    ];

    /** @var list<string> */
    private const PRESERVE_DIRS = [
        'storage/logs',
        'storage/framework/sessions',
    ];

    /**
     * @return array{files: array<string, string>, dirs: array<string, string>, tempBase: ?string}
     */
    public function snapshot(string $apiRoot): array
    {
        $files = [];
        foreach (self::PRESERVE_FILES as $relative) {
            $path = $apiRoot.'/'.$relative;
            if (! is_file($path)) {
                continue;
            }
            $tmp = tempnam(sys_get_temp_dir(), 'wgw-preserve-');
            if ($tmp === false || ! @copy($path, $tmp)) {
                continue;
            }
            $files[$relative] = $tmp;
        }

        $dirs = [];
        $tempBase = null;
        foreach (self::PRESERVE_DIRS as $relative) {
            $path = $apiRoot.'/'.$relative;
            if (! is_dir($path) || ! $this->directoryHasContent($path)) {
                continue;
            }
            if ($tempBase === null) {
                $tempBase = sys_get_temp_dir().'/wgw-preserve-dir-'.uniqid('', true);
                @mkdir($tempBase, 0700, true);
            }
            $dest = $tempBase.'/'.$relative;
            if (! $this->copyTree($path, $dest)) {
                continue;
            }
            $dirs[$relative] = $dest;
        }

        return ['files' => $files, 'dirs' => $dirs, 'tempBase' => $tempBase];
    }

    /**
     * @param  array{files: array<string, string>, dirs: array<string, string>, tempBase: ?string}  $preserved
     */
    public function restore(string $apiRoot, array $preserved): void
    {
        foreach ($preserved['files'] as $relative => $tmp) {
            if (! is_file($tmp)) {
                continue;
            }
            $dest = $apiRoot.'/'.$relative;
            $dir = dirname($dest);
            if (! is_dir($dir) && ! @mkdir($dir, 0775, true)) {
                continue;
            }
            @copy($tmp, $dest);
            @unlink($tmp);
        }

        foreach ($preserved['dirs'] as $relative => $tmpDir) {
            if (! is_dir($tmpDir)) {
                continue;
            }
            $dest = $apiRoot.'/'.$relative;
            if (is_dir($dest)) {
                $this->removeTree($dest);
            }
            $parent = dirname($dest);
            if (! is_dir($parent)) {
                @mkdir($parent, 0775, true);
            }
            $this->copyTree($tmpDir, $dest);
        }

        $this->cleanupSnapshot($preserved);
    }

    /**
     * @param  array{files: array<string, string>, dirs: array<string, string>, tempBase: ?string}  $preserved
     */
    public function cleanupSnapshot(array $preserved): void
    {
        foreach ($preserved['files'] as $tmp) {
            if (is_file($tmp)) {
                @unlink($tmp);
            }
        }
        $tempBase = $preserved['tempBase'] ?? null;
        if (is_string($tempBase) && is_dir($tempBase)) {
            $this->removeTree($tempBase);
        }
    }

    private function directoryHasContent(string $dir): bool
    {
        $items = scandir($dir);
        if (! is_array($items)) {
            return false;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            if ($item === '.gitignore') {
                continue;
            }

            return true;
        }

        return false;
    }

    private function copyTree(string $source, string $dest): bool
    {
        if (is_file($source)) {
            $parent = dirname($dest);
            if (! is_dir($parent) && ! @mkdir($parent, 0775, true)) {
                return false;
            }

            return @copy($source, $dest);
        }
        if (! is_dir($source)) {
            return false;
        }
        if (! is_dir($dest) && ! @mkdir($dest, 0775, true)) {
            return false;
        }
        $items = scandir($source);
        if (! is_array($items)) {
            return false;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            if (! $this->copyTree($source.'/'.$item, $dest.'/'.$item)) {
                return false;
            }
        }

        return true;
    }

    private function removeTree(string $path): void
    {
        if (is_file($path) || is_link($path)) {
            @unlink($path);

            return;
        }
        if (! is_dir($path)) {
            return;
        }
        $items = scandir($path);
        if (! is_array($items)) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $this->removeTree($path.'/'.$item);
        }
        @rmdir($path);
    }
}
