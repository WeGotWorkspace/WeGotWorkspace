<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * Backups of a migrated legacy wgw-config.php.
 *
 * The file holds database credentials. It used to be copied next to the
 * install root as wgw-config.php.bak.<timestamp>, inside the published
 * website, where no deny rule matched it. Backups now live in the data
 * directory under config-backups/, and older ones are moved there.
 */
final class LegacyConfigBackups
{
    private const PREFIX = 'wgw-config.php.bak.';

    public static function dir(string $installRoot, string $dataDir): string
    {
        return self::resolve($installRoot, $dataDir).'/config-backups';
    }

    /** Copies $source to a new backup. Returns false when the data directory is not usable. */
    public static function write(string $installRoot, string $dataDir, string $source, string $timestamp): bool
    {
        $dir = self::ensureDir($installRoot, $dataDir);
        if ($dir === null) {
            return false;
        }
        $target = $dir.'/'.self::PREFIX.$timestamp;
        if (! @copy($source, $target)) {
            return false;
        }
        @chmod($target, 0600);

        return true;
    }

    /** Newest backup in the data directory or, from older installs, the install root. */
    public static function latest(string $installRoot, string $dataDir): ?string
    {
        $found = array_merge(
            self::globBackups(self::dir($installRoot, $dataDir)),
            self::globBackups(rtrim($installRoot, '/')),
        );
        if ($found === []) {
            return null;
        }
        usort($found, static fn (string $a, string $b): int => strcmp(basename($a), basename($b)));
        $latest = end($found);

        return is_readable($latest) ? $latest : null;
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

    private static function ensureDir(string $installRoot, string $dataDir): ?string
    {
        if (! is_dir(self::resolve($installRoot, $dataDir))) {
            return null;
        }
        $dir = self::dir($installRoot, $dataDir);
        if (! is_dir($dir) && ! @mkdir($dir, 0700, true) && ! is_dir($dir)) {
            return null;
        }

        return is_writable($dir) ? $dir : null;
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
