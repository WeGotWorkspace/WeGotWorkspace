<?php

declare(strict_types=1);

/**
 * Filesystem probes that respect PHP open_basedir restrictions on shared hosts.
 */
final class WgwSafePath
{
    public static function isFile(string $path): bool
    {
        return self::isAccessible($path) && is_file($path);
    }

    public static function isAccessible(string $path): bool
    {
        $path = self::normalize($path);
        $openBasedir = ini_get('open_basedir');
        if (! is_string($openBasedir) || $openBasedir === '') {
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
