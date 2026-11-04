<?php

declare(strict_types=1);

namespace App\Services\Drive\FolderZip;

use App\Models\JmapFileNode;
use App\Storage\WgwStorage;

/**
 * Writes a Drive folder as a stored zip to a sink (#1621): the walker picks
 * the entries, each file streams from the drive in fixed chunks, and the
 * writer adds the zip structure. Nothing is buffered beyond one chunk and
 * the spooled central directory.
 *
 * A file whose stream cannot be opened (gone since the walk listed it) is
 * left out. A file that changes while it is read is stored as read.
 */
final class FolderZipStreamer
{
    public function __construct(
        private readonly FolderZipWalker $walker,
        private readonly WgwStorage $storage,
        private readonly int $chunkBytes = ZipStreamWriter::CHUNK_BYTES,
    ) {}

    /**
     * @param  array{username: string, role: string}  $principal
     * @param  callable(string): void  $sink
     * @param  (callable(): void)|null  $activity  called after each entry and each file chunk
     */
    public function stream(JmapFileNode $folder, array $principal, callable $sink, ?callable $activity = null): void
    {
        $this->write($this->walker->entries($folder, $principal), $sink, $activity);
    }

    /**
     * Several selected items under one top folder `$top` (#1905).
     *
     * @param  list<JmapFileNode>  $items
     * @param  array{username: string, role: string}  $principal
     * @param  callable(string): void  $sink
     * @param  (callable(): void)|null  $activity  called after each entry and each file chunk
     */
    public function streamSelection(string $top, array $items, array $principal, callable $sink, ?callable $activity = null): void
    {
        $this->write($this->walker->selectionEntries($top, $items, $principal), $sink, $activity);
    }

    /**
     * @param  iterable<array{directory: bool, path: string, key: string}>  $entries
     * @param  callable(string): void  $sink
     * @param  (callable(): void)|null  $activity
     */
    private function write(iterable $entries, callable $sink, ?callable $activity): void
    {
        $zip = new ZipStreamWriter($sink, $this->chunkBytes);

        foreach ($entries as $entry) {
            if ($entry['directory']) {
                $zip->addDirectory($entry['path'], $this->directoryTime($entry['key']));
            } else {
                $this->addFile($zip, $entry['path'], $entry['key'], $activity);
            }
            if ($activity !== null) {
                $activity();
            }
        }

        $zip->finish();
    }

    /**
     * @param  (callable(): void)|null  $activity
     */
    private function addFile(ZipStreamWriter $zip, string $path, string $key, ?callable $activity): void
    {
        try {
            $stream = $this->storage->files()->readStream($key);
        } catch (\Throwable) {
            $stream = null;
        }
        if (! is_resource($stream)) {
            return;
        }

        try {
            $stat = @fstat($stream);
            $size = is_array($stat) && (int) $stat['size'] > 0 ? (int) $stat['size'] : $this->storedSize($key);
            $mtime = is_array($stat) && (int) $stat['mtime'] > 0 ? (int) $stat['mtime'] : $this->directoryTime($key);
            $zip->addFile($path, $stream, $mtime, $size, $activity);
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }
    }

    /**
     * The size from storage when the stream reports none, so a file of 4 GiB
     * or more still takes the ZIP64 path instead of being cut at 4 GiB.
     */
    private function storedSize(string $key): int
    {
        try {
            return $this->storage->files()->fileSize($key);
        } catch (\Throwable) {
            return 0;
        }
    }

    private function directoryTime(string $key): int
    {
        if ($key === '') {
            // A selection's top folder has no storage: the time of the download.
            return time();
        }
        try {
            return $this->storage->files()->lastModified($key);
        } catch (\Throwable) {
            return time();
        }
    }
}
