<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Where packages/api loads its .env from, resolved before Laravel boots.
 *
 * Order: the `WGW_ENV_FILE` server/environment variable, then the pointer
 * file `packages/api/.env.path`, then `packages/api/.env`. The pointer holds
 * only an absolute path, so it may sit in the published tree; the .env it
 * names (APP_KEY, database password) does not have to (#1484).
 *
 * A pointer or variable that names a missing or unreadable file stops the
 * boot instead of falling back to the in-tree file: that fallback would seed
 * a new APP_KEY and show the installer on a live site.
 *
 * Plain PHP only: bootstrap/app.php calls this before the container exists.
 */
final class WgwEnvLocation
{
    public const POINTER_FILE = '.env.path';

    public const OVERRIDE_KEY = 'WGW_ENV_FILE';

    public static function defaultFile(string $apiRoot): string
    {
        return self::normalize($apiRoot).'/.env';
    }

    public static function pointerPath(string $apiRoot): string
    {
        return self::normalize($apiRoot).'/'.self::POINTER_FILE;
    }

    /**
     * The .env file this API root reads and writes.
     */
    public static function envFile(string $apiRoot): string
    {
        return self::relocated($apiRoot) ?? self::defaultFile($apiRoot);
    }

    /**
     * The relocated .env path, or null when the default in-tree file applies.
     *
     * @throws \RuntimeException when the variable or pointer names an invalid path
     */
    public static function relocated(string $apiRoot): ?string
    {
        $override = self::override();
        if ($override !== null) {
            return self::unlessDefault($apiRoot, self::validated($override, self::OVERRIDE_KEY));
        }

        $pointer = self::pointerPath($apiRoot);
        if (! is_file($pointer)) {
            return null;
        }

        return self::unlessDefault($apiRoot, self::validated(self::readPointer($pointer), $pointer));
    }

    /**
     * {@see relocated()}, and the file must be readable: the boot stops here
     * rather than run without its configuration.
     *
     * @throws \RuntimeException
     */
    public static function relocatedForBoot(string $apiRoot): ?string
    {
        $path = self::relocated($apiRoot);
        if ($path !== null && (! is_file($path) || ! is_readable($path))) {
            throw new \RuntimeException(
                'The .env file named by '.self::source().' is missing or not readable: '.$path
                .'. Restore it, or point '.self::source().' at the right file (see INSTALL.md).'
            );
        }

        return $path;
    }

    /**
     * Pointer file contents for an absolute .env path.
     */
    public static function pointerContents(string $envFile): string
    {
        return "# Where this install keeps its .env (see INSTALL.md). This file holds a path only.\n"
            .self::validated($envFile, 'The pointer')."\n";
    }

    private static function override(): ?string
    {
        $raw = $_SERVER[self::OVERRIDE_KEY] ?? $_ENV[self::OVERRIDE_KEY] ?? getenv(self::OVERRIDE_KEY);
        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }

        return trim($raw);
    }

    private static function source(): string
    {
        return self::override() !== null ? self::OVERRIDE_KEY : self::POINTER_FILE;
    }

    private static function readPointer(string $pointer): string
    {
        $contents = @file_get_contents($pointer);
        if (! is_string($contents)) {
            throw new \RuntimeException('Could not read '.$pointer.'.');
        }
        foreach (preg_split('/\r\n|\n|\r/', $contents) ?: [] as $line) {
            $line = trim($line);
            if ($line !== '' && ! str_starts_with($line, '#')) {
                return $line;
            }
        }

        return '';
    }

    private static function validated(string $path, string $source): string
    {
        $path = str_replace('\\', '/', trim($path));
        $absolute = str_starts_with($path, '/') || preg_match('#^[A-Za-z]:/#', $path) === 1;
        $segments = explode('/', $path);
        if (! $absolute
            || str_contains($path, "\0")
            || in_array('..', $segments, true)
            || in_array('.', $segments, true)
            || str_ends_with($path, '/')) {
            throw new \RuntimeException($source.' must name an absolute path to the .env file, without . or .. segments.');
        }

        return $path;
    }

    private static function unlessDefault(string $apiRoot, string $path): ?string
    {
        return $path === self::defaultFile($apiRoot) ? null : $path;
    }

    private static function normalize(string $path): string
    {
        return rtrim(str_replace('\\', '/', $path), '/');
    }
}
