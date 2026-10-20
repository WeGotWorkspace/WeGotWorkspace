<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\WebRootDeny;

/**
 * Backups of a migrated legacy wgw-config.php.
 *
 * They used to be written next to the install root, inside the published
 * website. Backups now live in the data directory under config-backups/,
 * or in packages/api when the data directory is not usable. Both are
 * denied by the web server. Older install-root backups are moved.
 */
final class LegacyConfigBackups
{
    private const PREFIX = 'wgw-config.php.bak.';

    public static function dir(string $installRoot, string $dataDir): string
    {
        return self::resolve($installRoot, $dataDir).'/config-backups';
    }

    /**
     * Copies $source to a new backup in the data directory, else in $apiRoot.
     * Returns false when neither can be written.
     */
    public static function write(string $installRoot, string $dataDir, string $apiRoot, string $source, string $timestamp): bool
    {
        foreach ([self::ensureDir($installRoot, $dataDir), self::writableDir($apiRoot)] as $dir) {
            if ($dir !== null && self::copyPrivate($source, $dir.'/'.self::PREFIX.$timestamp)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Newest backup: the data directory first, then packages/api, then the
     * install root of older installs.
     */
    public static function latest(string $installRoot, string $dataDir, string $apiRoot): ?string
    {
        foreach ([self::dir($installRoot, $dataDir), rtrim($apiRoot, '/'), rtrim($installRoot, '/')] as $dir) {
            $found = self::globBackups($dir);
            if ($found === []) {
                continue;
            }
            sort($found);
            $latest = end($found);

            return is_readable($latest) ? $latest : null;
        }

        return null;
    }

    /** Moves backups out of the install root. Leaves them when the data directory is not usable. */
    public static function relocate(string $installRoot, string $dataDir): void
    {
        $old = self::globBackups(rtrim($installRoot, '/'));
        if ($old === []) {
            return;
        }
        $dir = self::ensureDir($installRoot, $dataDir);
        if ($dir === null) {
            return;
        }
        foreach ($old as $path) {
            $target = $dir.'/'.basename($path);
            if (@rename($path, $target) || (@copy($path, $target) && @unlink($path))) {
                @chmod($target, 0600);
            }
        }
    }

    public static function hasInstallRootBackups(string $installRoot): bool
    {
        return self::globBackups(rtrim($installRoot, '/')) !== [];
    }

    private static function ensureDir(string $installRoot, string $dataDir): ?string
    {
        $data = self::resolve($installRoot, $dataDir);
        if (! is_dir($data)) {
            return null;
        }
        // A data directory inside the web root under another name than
        // wgw-content is covered only by its own deny file.
        WebRootDeny::ensure($data);
        $dir = self::dir($installRoot, $dataDir);
        if (! is_dir($dir) && ! @mkdir($dir, 0700, true) && ! is_dir($dir)) {
            return null;
        }

        return self::writableDir($dir);
    }

    private static function writableDir(string $dir): ?string
    {
        $dir = rtrim($dir, '/');

        return $dir !== '' && is_dir($dir) && is_writable($dir) ? $dir : null;
    }

    /** Restricts the target before it holds any content. */
    private static function copyPrivate(string $source, string $target): bool
    {
        if (! @touch($target) || ! @chmod($target, 0600)) {
            return false;
        }
        $content = @file_get_contents($source);
        if (! is_string($content) || @file_put_contents($target, $content, LOCK_EX) === false) {
            @unlink($target);

            return false;
        }

        return true;
    }

    /** @return list<string> */
    private static function globBackups(string $dir): array
    {
        $found = glob($dir.'/'.self::PREFIX.'*');

        return is_array($found) ? array_values(array_filter($found, 'is_file')) : [];
    }

    private static function resolve(string $installRoot, string $dataDir): string
    {
        $dataDir = str_replace('\\', '/', trim($dataDir));
        if ($dataDir === '') {
            $dataDir = './wgw-content';
        }
        if (str_starts_with($dataDir, '/') || preg_match('#^[A-Za-z]:/#', $dataDir) === 1) {
            return rtrim($dataDir, '/');
        }

        return rtrim(rtrim($installRoot, '/').'/'.preg_replace('#^(\./)+#', '', $dataDir), '/');
    }
}
