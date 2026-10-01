<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * Serializes every writer of packages/api/.env and replaces the file with rename().
 *
 * Install requests and the installer wizard both patch this file. Separate locks
 * let one writer replace the other's DB_* lines or APP_KEY. The temp file is
 * owner-only before it is filled, so the password and APP_KEY are never
 * published as a world-readable .env. rename() keeps the previous owner and
 * group when the file already exists.
 */
final class EnvFileWriter
{
    /**
     * The mutator returns null when the file should stay unchanged.
     * Returns false when the contents did not change, or when the write failed.
     *
     * @param  callable(string): ?string  $mutator
     */
    public function update(string $envPath, callable $mutator): bool
    {
        try {
            return $this->rewrite($envPath, $mutator);
        } catch (\RuntimeException) {
            return false;
        }
    }

    /**
     * @param  callable(string): ?string  $mutator
     */
    public function rewrite(string $envPath, callable $mutator): bool
    {
        $target = $this->writeTarget($envPath);
        $lockPath = $target.'.lock';
        $lock = fopen($lockPath, 'c');
        if ($lock === false) {
            throw new \RuntimeException('Could not lock '.$envPath);
        }
        @chmod($lockPath, 0660);

        try {
            if (! flock($lock, LOCK_EX)) {
                throw new \RuntimeException('Could not lock '.$envPath);
            }
            $content = is_file($target) ? (string) file_get_contents($target) : '';
            $next = $mutator($content);
            if (! is_string($next) || $next === $content) {
                $this->restrictToOwner($target);

                return false;
            }

            $tmp = $target.'.tmp.'.bin2hex(random_bytes(4));
            try {
                $this->writeOwnerOnly($tmp, $next);
            } catch (\RuntimeException $e) {
                @unlink($tmp);
                throw new \RuntimeException('Could not write '.$envPath, 0, $e);
            }
            $this->keepExistingOwner($tmp, $target);
            if (! rename($tmp, $target)) {
                @unlink($tmp);
                throw new \RuntimeException('Could not write '.$envPath);
            }

            return true;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /**
     * Create the temp file empty, restrict it, then write. Contents never sit
     * on disk under the process umask.
     */
    private function writeOwnerOnly(string $tmp, string $contents): void
    {
        $out = fopen($tmp, 'x');
        if ($out === false) {
            throw new \RuntimeException('Could not create temporary env file');
        }
        $this->restrictToOwner($tmp);

        try {
            $offset = 0;
            $length = strlen($contents);
            while ($offset < $length) {
                $wrote = fwrite($out, substr($contents, $offset));
                if ($wrote === false || $wrote === 0) {
                    throw new \RuntimeException('Could not write temporary env file');
                }
                $offset += $wrote;
            }
            if (! fflush($out)) {
                throw new \RuntimeException('Could not write temporary env file');
            }
        } finally {
            fclose($out);
        }
    }

    /**
     * rename() creates a new inode owned by this process. Copy the previous
     * owner first so a root artisan command does not leave .env as root:root
     * mode 0600, which www-data cannot read.
     */
    private function keepExistingOwner(string $tmp, string $target): void
    {
        if (! is_file($target)) {
            return;
        }
        $owner = fileowner($target);
        $group = filegroup($target);
        if (is_int($owner)) {
            @chown($tmp, $owner);
        }
        if (is_int($group)) {
            @chgrp($tmp, $group);
        }
    }

    private function restrictToOwner(string $path): void
    {
        if (is_file($path)) {
            @chmod($path, 0600);
        }
    }

    /**
     * realpath() follows a chain of symlinks onto the config volume.
     * A dangling link has no real path yet, so resolve that one link.
     */
    private function writeTarget(string $envPath): string
    {
        $real = realpath($envPath);
        if (is_string($real)) {
            return $real;
        }

        if (is_link($envPath)) {
            $link = readlink($envPath);
            if (is_string($link)) {
                if (str_starts_with($link, '/')) {
                    return $link;
                }

                return dirname($envPath).'/'.$link;
            }
        }

        return $envPath;
    }
}
