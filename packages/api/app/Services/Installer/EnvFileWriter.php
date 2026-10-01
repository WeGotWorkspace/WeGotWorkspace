<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * Atomic replace for packages/api/.env.
 *
 * InstallerEnvWriter and ApiRuntimeEnvService both call this. They take the
 * same lock and the same rename, so one cannot drop the other's APP_KEY or
 * DB_* lines. The temp file is mode 0600 before rename, and so is the result.
 * An existing target keeps its owner and group, because rename() would
 * otherwise create an inode owned by this process.
 */
final class EnvFileWriter
{
    /**
     * The mutator returns null when the file should stay unchanged.
     * Returns true when the contents change.
     *
     * @param  callable(string): ?string  $mutator
     */
    public function update(string $envPath, callable $mutator): bool
    {
        $target = $this->envWriteTarget($envPath);
        $lockPath = $target.'.lock';
        $lock = fopen($lockPath, 'c');
        if ($lock === false) {
            throw new \RuntimeException('Could not lock packages/api/.env');
        }

        try {
            if (! chmod($lockPath, 0660) || ! flock($lock, LOCK_EX)) {
                throw new \RuntimeException('Could not lock packages/api/.env');
            }
            $content = is_file($target) ? (string) file_get_contents($target) : '';
            $next = $mutator($content);
            if (! is_string($next) || $next === $content) {
                if (is_file($target)) {
                    $this->chmodPrivate($target);
                }

                return false;
            }

            $tmp = $target.'.tmp.'.bin2hex(random_bytes(4));
            $out = fopen($tmp, 'x');
            if ($out === false) {
                throw new \RuntimeException('Could not write packages/api/.env');
            }
            // Mode 0600 before the secret bytes are written, and before rename.
            if (! chmod($tmp, 0600)) {
                fclose($out);
                @unlink($tmp);
                throw new \RuntimeException('Could not write packages/api/.env');
            }
            if (fwrite($out, $next) === false) {
                fclose($out);
                @unlink($tmp);
                throw new \RuntimeException('Could not write packages/api/.env');
            }
            fclose($out);
            if (is_file($target)) {
                // Succeeds only as root. @ leaves shared hosting on the same user.
                $owner = fileowner($target);
                $group = filegroup($target);
                if (is_int($owner)) {
                    @chown($tmp, $owner);
                }
                if (is_int($group)) {
                    @chgrp($tmp, $group);
                }
            }
            if (! rename($tmp, $target)) {
                @unlink($tmp);
                throw new \RuntimeException('Could not write packages/api/.env');
            }

            return true;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /**
     * Canonical path of an existing file, including a symlink chain.
     * A dangling link falls back to one readlink so rename does not replace the link.
     */
    public function envWriteTarget(string $envPath): string
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

    private function chmodPrivate(string $path): void
    {
        if (! chmod($path, 0600)) {
            throw new \RuntimeException('Could not write packages/api/.env');
        }
    }
}
