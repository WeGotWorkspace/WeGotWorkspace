<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Filesystem probes that respect PHP open_basedir restrictions on shared hosts.
 */
final class SafePath
{
    public static function isFile(string $path): bool
    {
        return self::isAccessible($path) && is_file($path);
    }

    public static function isReadable(string $path): bool
    {
        return self::isAccessible($path) && is_readable($path);
    }

    public static function isDir(string $path): bool
    {
        return self::isAccessible($path) && is_dir($path);
    }

    public static function isHtmlFile(string $path): bool
    {
        if (! self::isFile($path)) {
            return false;
        }

        $head = @file_get_contents($path, false, null, 0, 512);
        if (! is_string($head) || $head === '' || str_contains($head, "\0")) {
            return false;
        }

        return str_starts_with(ltrim($head), '<');
    }

    public static function isAccessible(string $path, ?string $openBasedir = null): bool
    {
        $path = self::normalize($path);
        $openBasedir ??= (string) ini_get('open_basedir');
        if ($openBasedir === '') {
            return true;
        }

        foreach (explode(PATH_SEPARATOR, $openBasedir) as $allowed) {
            if ($allowed === '') {
                continue;
            }
            $allowed = self::normalize($allowed);
            if ($path === $allowed || str_starts_with($path.'/', $allowed.'/')) {
                return true;
            }
        }

        return false;
    }

    private static function normalize(string $path): string
    {
        return rtrim(str_replace('\\', '/', $path), '/');
    }
}
