<?php

declare(strict_types=1);

namespace App\Storage\Local;

use App\Services\Jmap\Blobs\StorageFullException;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Filesystem\FilesystemAdapter;
use League\Flysystem\Local\LocalFilesystemAdapter;

/**
 * Local-disk primitives Flysystem does not offer (#1500): appending to a
 * file, truncating it, and renaming a file across two local disks on the
 * same device. This is the one path the greenfield guard exempts for raw
 * PHP file functions; callers check isLocal() and fall back to Flysystem
 * streams for any other adapter.
 *
 * A write that fails for lack of space (ENOSPC, or a hosting quota's EDQUOT
 * that disk_free_space() does not show) surfaces as StorageFullException.
 */
class LocalDiskFiles
{
    private const CHUNK = 1024 * 1024;

    /**
     * A php://temp stream holding $contents (spills to a temp file past
     * 2 MB), positioned at the start.
     *
     * @return resource
     */
    public static function tempStream(string $contents = '')
    {
        $stream = fopen('php://temp', 'w+b');
        if ($stream === false) {
            throw new \RuntimeException('Could not open a temporary stream.');
        }
        fwrite($stream, $contents);
        rewind($stream);

        return $stream;
    }

    public function isLocal(Filesystem $disk): bool
    {
        return $disk instanceof FilesystemAdapter && $disk->getAdapter() instanceof LocalFilesystemAdapter;
    }

    /**
     * Appends at most $maxBytes from $source to the file at $key (created
     * when missing), feeding every appended chunk to $onChunk. Returns the
     * number of bytes appended.
     *
     * @param  resource  $source
     * @param  (callable(string): void)|null  $onChunk
     */
    public function append(Filesystem $disk, string $key, $source, ?int $maxBytes = null, ?callable $onChunk = null): int
    {
        $path = $this->absolutePath($disk, $key);
        $this->ensureDirectory(dirname($path));
        $target = $this->open($path, 'ab');
        $written = 0;
        try {
            while (! feof($source) && ($maxBytes === null || $written < $maxBytes)) {
                $want = $maxBytes === null ? self::CHUNK : min(self::CHUNK, $maxBytes - $written);
                if ($want < 1) {
                    break;
                }
                $chunk = fread($source, $want);
                if ($chunk === false || $chunk === '') {
                    break;
                }
                $this->write($target, $chunk);
                if ($onChunk !== null) {
                    $onChunk($chunk);
                }
                $written += strlen($chunk);
            }
            if (! fflush($target)) {
                throw StorageFullException::fromLastError('flush') ?? new StorageFullException('The storage is full.');
            }
        } finally {
            fclose($target);
        }

        return $written;
    }

    /**
     * Cuts the file back to $size bytes (drops bytes a step wrote before it
     * was interrupted). A missing file is created empty when $size is 0.
     */
    public function truncate(Filesystem $disk, string $key, int $size): void
    {
        $path = $this->absolutePath($disk, $key);
        $this->ensureDirectory(dirname($path));
        $handle = $this->open($path, 'cb');
        try {
            ftruncate($handle, max(0, $size));
        } finally {
            fclose($handle);
        }
    }

    /**
     * Current size on disk (clearing the stat cache first), or null.
     */
    public function size(Filesystem $disk, string $key): ?int
    {
        $path = $this->absolutePath($disk, $key);
        clearstatcache(true, $path);
        $size = @filesize($path);

        return $size === false ? null : $size;
    }

    /**
     * Renames a file from one local disk to another when both live on the
     * same device; returns false (nothing changed) otherwise, so the caller
     * falls back to a streamed copy. An existing target is replaced
     * atomically.
     */
    public function moveAcross(Filesystem $fromDisk, string $fromKey, Filesystem $toDisk, string $toKey): bool
    {
        if (! $this->isLocal($fromDisk) || ! $this->isLocal($toDisk)) {
            return false;
        }
        $from = $this->absolutePath($fromDisk, $fromKey);
        $to = $this->absolutePath($toDisk, $toKey);
        $this->ensureDirectory(dirname($to));
        if (! $this->sameDevice($from, dirname($to))) {
            return false;
        }

        return @rename($from, $to);
    }

    public function sameDevice(string $pathA, string $pathB): bool
    {
        $a = @stat($pathA);
        $b = @stat($pathB);

        return is_array($a) && is_array($b) && $a['dev'] === $b['dev'];
    }

    public function absolutePath(Filesystem $disk, string $key): string
    {
        if (! $disk instanceof FilesystemAdapter) {
            throw new \LogicException('Local disk access needs a Laravel filesystem adapter.');
        }

        return $disk->path($key);
    }

    /**
     * @return resource
     */
    protected function open(string $path, string $mode)
    {
        $handle = @fopen($path, $mode);
        if ($handle === false) {
            throw StorageFullException::fromLastError('open') ?? new \RuntimeException('Could not open '.basename($path).'.');
        }

        return $handle;
    }

    /**
     * @param  resource  $handle
     */
    protected function write($handle, string $chunk): void
    {
        $length = strlen($chunk);
        $done = 0;
        while ($done < $length) {
            $written = @fwrite($handle, $done === 0 ? $chunk : substr($chunk, $done));
            if ($written === false || $written === 0) {
                // A short write on a local disk means the device or the
                // account's hosting quota is full.
                throw StorageFullException::fromLastError('write') ?? new StorageFullException('The storage is full.');
            }
            $done += $written;
        }
    }

    private function ensureDirectory(string $dir): void
    {
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw StorageFullException::fromLastError('mkdir') ?? new \RuntimeException('Could not create a directory.');
        }
    }
}
