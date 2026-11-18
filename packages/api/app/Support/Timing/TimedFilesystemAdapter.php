<?php

declare(strict_types=1);

namespace App\Support\Timing;

use League\Flysystem\ChecksumAlgoIsNotSupported;
use League\Flysystem\ChecksumProvider;
use League\Flysystem\Config;
use League\Flysystem\FileAttributes;
use League\Flysystem\FilesystemAdapter;

/**
 * Times every Flysystem operation on the wgw disks into RequestTimings
 * (#2244). A stream that readStream() returns is read by the caller later;
 * only opening it counts here.
 */
final class TimedFilesystemAdapter implements ChecksumProvider, FilesystemAdapter
{
    public function __construct(
        private readonly FilesystemAdapter $inner,
        private readonly RequestTimings $timings,
    ) {}

    public function fileExists(string $path): bool
    {
        return $this->timings->storage(fn (): bool => $this->inner->fileExists($path));
    }

    public function directoryExists(string $path): bool
    {
        return $this->timings->storage(fn (): bool => $this->inner->directoryExists($path));
    }

    public function write(string $path, string $contents, Config $config): void
    {
        $this->timings->storage(fn () => $this->inner->write($path, $contents, $config));
    }

    public function writeStream(string $path, $contents, Config $config): void
    {
        $this->timings->storage(fn () => $this->inner->writeStream($path, $contents, $config));
    }

    public function read(string $path): string
    {
        return $this->timings->storage(fn (): string => $this->inner->read($path));
    }

    public function readStream(string $path)
    {
        return $this->timings->storage(fn () => $this->inner->readStream($path));
    }

    public function delete(string $path): void
    {
        $this->timings->storage(fn () => $this->inner->delete($path));
    }

    public function deleteDirectory(string $path): void
    {
        $this->timings->storage(fn () => $this->inner->deleteDirectory($path));
    }

    public function createDirectory(string $path, Config $config): void
    {
        $this->timings->storage(fn () => $this->inner->createDirectory($path, $config));
    }

    public function setVisibility(string $path, string $visibility): void
    {
        $this->timings->storage(fn () => $this->inner->setVisibility($path, $visibility));
    }

    public function visibility(string $path): FileAttributes
    {
        return $this->timings->storage(fn (): FileAttributes => $this->inner->visibility($path));
    }

    public function mimeType(string $path): FileAttributes
    {
        return $this->timings->storage(fn (): FileAttributes => $this->inner->mimeType($path));
    }

    public function lastModified(string $path): FileAttributes
    {
        return $this->timings->storage(fn (): FileAttributes => $this->inner->lastModified($path));
    }

    public function fileSize(string $path): FileAttributes
    {
        return $this->timings->storage(fn (): FileAttributes => $this->inner->fileSize($path));
    }

    /**
     * A listing is lazy: the time of each step through it is summed, not the
     * caller's work between steps, and the listing counts as one operation.
     */
    public function listContents(string $path, bool $deep): iterable
    {
        $spent = 0;
        try {
            $started = hrtime(true);
            $listing = $this->inner->listContents($path, $deep);
            $iterator = match (true) {
                $listing instanceof \Iterator => $listing,
                $listing instanceof \Traversable => new \IteratorIterator($listing),
                default => new \ArrayIterator($listing),
            };
            $iterator->rewind();
            $spent += hrtime(true) - $started;
            for (; ;) {
                $started = hrtime(true);
                $valid = $iterator->valid();
                $item = $valid ? $iterator->current() : null;
                $spent += hrtime(true) - $started;
                if (! $valid) {
                    break;
                }
                yield $item;
                $started = hrtime(true);
                $iterator->next();
                $spent += hrtime(true) - $started;
            }
        } finally {
            $this->timings->addStorage($spent);
        }
    }

    public function move(string $source, string $destination, Config $config): void
    {
        $this->timings->storage(fn () => $this->inner->move($source, $destination, $config));
    }

    public function copy(string $source, string $destination, Config $config): void
    {
        $this->timings->storage(fn () => $this->inner->copy($source, $destination, $config));
    }

    public function checksum(string $path, Config $config): string
    {
        $inner = $this->inner;
        if (! $inner instanceof ChecksumProvider) {
            // Flysystem then hashes the file from a stream, as without this wrapper.
            throw new ChecksumAlgoIsNotSupported('The wrapped adapter does not provide checksums.');
        }

        return $this->timings->storage(fn (): string => $inner->checksum($path, $config));
    }
}
