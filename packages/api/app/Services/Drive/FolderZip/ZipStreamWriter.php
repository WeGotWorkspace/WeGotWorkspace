<?php

declare(strict_types=1);

namespace App\Services\Drive\FolderZip;

/**
 * A pure-PHP zip writer for one streamed response (#1621). Entries are
 * stored, not compressed, so it needs no zlib: only `hash('crc32b')`.
 *
 *  - A file below 4 GiB is one pass: its local header (bit 3: CRC and
 *    sizes follow in a data descriptor; bit 11: UTF-8 name), the bytes in
 *    fixed chunks, then a descriptor with the CRC-32 and the size actually
 *    read. A file that grows, shrinks, or fails mid-read is included as read
 *    and the archive stays valid. Reading stops at 4 GiB − 2 bytes.
 *  - A file of 4 GiB or more is ZIP64 and read twice: first for its CRC,
 *    then, from the same handle, into an entry whose local header carries
 *    the CRC and the sizes. macOS (Archive Utility, ditto) cannot extract a
 *    ZIP64 entry whose sizes are only in a data descriptor. If the file is
 *    rewritten in place between the two reads, the bytes are cut or
 *    zero-padded to the size of the first read: that one entry fails its CRC
 *    check and the rest of the archive stays valid.
 *  - ZIP64 offsets in central records past 4 GiB, and ZIP64 end records past
 *    65,534 entries or 4 GiB of archive.
 *  - Modification times as MS-DOS time and as an extended timestamp (UTC).
 *  - Central records are spooled to `php://temp` (in memory up to 1 MiB,
 *    then a temporary file) and copied out at the end, so memory use does
 *    not grow with the number of entries or their size.
 *
 * Callers pass entry paths that are already safe (see FolderZipWalker).
 */
final class ZipStreamWriter
{
    public const CHUNK_BYTES = 1024 * 1024;

    /** Files this large are ZIP64 and read twice (CRC first). */
    public const ZIP64_ENTRY_THRESHOLD = 0xFFFFFFFF;

    private const MAX_32 = 0xFFFFFFFF;

    private const MAX_16 = 0xFFFF;

    /** UNIX, spec version 4.5. */
    private const VERSION_MADE_BY = (3 << 8) | 45;

    private const VERSION_DEFAULT = 20;

    private const VERSION_ZIP64 = 45;

    private const FLAG_DATA_DESCRIPTOR = 0x0008;

    private const FLAG_UTF8 = 0x0800;

    private int $offset = 0;

    private int $entries = 0;

    private int $centralSize = 0;

    private bool $finished = false;

    private \SplTempFileObject $central;

    /** @var callable(string): void */
    private $sink;

    /**
     * @param  callable(string): void  $sink  receives every byte of the archive in order
     */
    public function __construct(callable $sink, private readonly int $chunkBytes = self::CHUNK_BYTES)
    {
        $this->sink = $sink;
        // php://temp: in memory up to 1 MiB, then a temporary file.
        $this->central = new \SplTempFileObject(1024 * 1024);
    }

    /** Adds `path/` (an empty folder survives this way). */
    public function addDirectory(string $path, int $mtime): void
    {
        $name = rtrim($path, '/').'/';
        $offset = $this->offset;
        [$time, $date] = self::dosTime($mtime);
        $this->emitLocalHeader($name, self::FLAG_UTF8, $time, $date, 0, 0, null, $mtime);
        $this->addCentralRecord($name, self::FLAG_UTF8, $time, $date, $mtime, 0, 0, false, $offset, (0o40755 << 16) | 0x10);
    }

    /**
     * Adds a file from an open stream (read to its end, not closed here).
     *
     * @param  resource  $stream
     * @param  int  $expectedSize  the size at open; 4 GiB or more → ZIP64, CRC first
     * @param  (callable(): void)|null  $afterChunk  called after each chunk is read
     * @return int bytes stored
     */
    public function addFile(string $path, $stream, int $mtime, int $expectedSize, ?callable $afterChunk = null): int
    {
        if ($expectedSize >= self::ZIP64_ENTRY_THRESHOLD) {
            $known = $this->crcFirst($stream, $afterChunk);
            if ($known !== null) {
                return $this->addKnownFile($path, $stream, $mtime, $known[0], $known[1], $afterChunk);
            }
        }

        return $this->addStreamedFile($path, $stream, $mtime, $expectedSize >= self::ZIP64_ENTRY_THRESHOLD, $afterChunk);
    }

    /**
     * @param  resource  $stream
     * @param  (callable(): void)|null  $afterChunk
     */
    private function addStreamedFile(string $path, $stream, int $mtime, bool $zip64, ?callable $afterChunk): int
    {
        $flags = self::FLAG_DATA_DESCRIPTOR | self::FLAG_UTF8;
        $offset = $this->offset;
        [$time, $date] = self::dosTime($mtime);
        $headerSize = $zip64 ? self::MAX_32 : 0;
        $this->emitLocalHeader($path, $flags, $time, $date, 0, $headerSize, $zip64 ? pack('PP', 0, 0) : null, $mtime);

        $hash = hash_init('crc32b');
        $size = 0;
        $limit = $zip64 ? PHP_INT_MAX : self::MAX_32 - 1;
        while ($size < $limit && ($chunk = $this->readChunk($stream, $limit - $size)) !== null) {
            hash_update($hash, $chunk);
            $size += strlen($chunk);
            $this->emit($chunk);
            if ($afterChunk !== null) {
                $afterChunk();
            }
        }
        $crc = self::crcValue($hash);

        $this->emit($zip64
            ? pack('VVPP', 0x08074B50, $crc, $size, $size)
            : pack('VVVV', 0x08074B50, $crc, $size, $size));
        $this->addCentralRecord($path, $flags, $time, $date, $mtime, $crc, $size, $zip64, $offset, 0o100644 << 16);

        return $size;
    }

    /**
     * @param  resource  $stream  positioned at its start
     * @param  (callable(): void)|null  $afterChunk
     */
    private function addKnownFile(string $path, $stream, int $mtime, int $crc, int $size, ?callable $afterChunk): int
    {
        $offset = $this->offset;
        [$time, $date] = self::dosTime($mtime);
        $this->emitLocalHeader($path, self::FLAG_UTF8, $time, $date, $crc, self::MAX_32, pack('PP', $size, $size), $mtime);

        $written = 0;
        while ($written < $size) {
            $chunk = $this->readChunk($stream, $size - $written)
                ?? str_repeat("\0", min($this->chunkBytes, $size - $written));
            $written += strlen($chunk);
            $this->emit($chunk);
            if ($afterChunk !== null) {
                $afterChunk();
            }
        }
        $this->addCentralRecord($path, self::FLAG_UTF8, $time, $date, $mtime, $crc, $size, true, $offset, 0o100644 << 16);

        return $size;
    }

    /**
     * Reads the stream for its CRC and size, then rewinds it; null when the
     * stream cannot be rewound.
     *
     * @param  resource  $stream
     * @param  (callable(): void)|null  $afterChunk
     * @return array{0: int, 1: int}|null
     */
    private function crcFirst($stream, ?callable $afterChunk): ?array
    {
        if (! stream_get_meta_data($stream)['seekable']) {
            return null;
        }
        $hash = hash_init('crc32b');
        $size = 0;
        while (($chunk = $this->readChunk($stream, PHP_INT_MAX)) !== null) {
            hash_update($hash, $chunk);
            $size += strlen($chunk);
            if ($afterChunk !== null) {
                $afterChunk();
            }
        }

        return rewind($stream) ? [self::crcValue($hash), $size] : null;
    }

    /**
     * @param  string|null  $zip64Sizes  16 bytes (uncompressed, compressed) for a ZIP64 entry
     */
    private function emitLocalHeader(string $path, int $flags, int $time, int $date, int $crc, int $sizeField, ?string $zip64Sizes, int $mtime): void
    {
        $extra = ($zip64Sizes !== null ? pack('vv', 0x0001, 16).$zip64Sizes : '').self::timestampExtra($mtime);
        $this->emit(pack(
            'VvvvvvVVVvv',
            0x04034B50, $zip64Sizes !== null ? self::VERSION_ZIP64 : self::VERSION_DEFAULT, $flags, 0, $time, $date,
            $crc, $sizeField, $sizeField, strlen($path), strlen($extra),
        ).$path.$extra);
    }

    /**
     * @param  resource  $stream
     */
    private function readChunk($stream, int $limit): ?string
    {
        if (feof($stream)) {
            return null;
        }
        $chunk = @fread($stream, max(1, min($this->chunkBytes, $limit)));

        return $chunk === false || $chunk === '' ? null : $chunk;
    }

    private static function crcValue(\HashContext $hash): int
    {
        /** @var array{1: int} $crc */
        $crc = unpack('N', hash_final($hash, true));

        return $crc[1];
    }

    /** Writes the central directory and the end records. */
    public function finish(): void
    {
        if ($this->finished) {
            return;
        }
        $this->finished = true;

        $centralOffset = $this->offset;
        $this->central->rewind();
        while (! $this->central->eof()) {
            $chunk = $this->central->fread($this->chunkBytes);
            if ($chunk === false || $chunk === '') {
                break;
            }
            $this->emit($chunk);
        }
        $this->central = new \SplTempFileObject(0);

        if ($this->entries >= self::MAX_16 || $this->centralSize >= self::MAX_32 || $centralOffset >= self::MAX_32) {
            $zip64EndOffset = $this->offset;
            $this->emit(pack(
                'VPvvVVPPPP',
                0x06064B50, 44, self::VERSION_MADE_BY, self::VERSION_ZIP64, 0, 0,
                $this->entries, $this->entries, $this->centralSize, $centralOffset,
            ));
            $this->emit(pack('VVPV', 0x07064B50, 0, $zip64EndOffset, 1));
        }

        $count = min($this->entries, self::MAX_16);
        $this->emit(pack(
            'VvvvvVVv',
            0x06054B50, 0, 0, $count, $count,
            min($this->centralSize, self::MAX_32), min($centralOffset, self::MAX_32), 0,
        ));
    }

    private function addCentralRecord(
        string $name,
        int $flags,
        int $time,
        int $date,
        int $mtime,
        int $crc,
        int $size,
        bool $zip64,
        int $offset,
        int $externalAttributes,
    ): void {
        $zip64Extra = '';
        if ($zip64) {
            $zip64Extra .= pack('PP', $size, $size);
        }
        $offsetOverflows = $offset >= self::MAX_32;
        if ($offsetOverflows) {
            $zip64Extra .= pack('P', $offset);
        }
        $extra = ($zip64Extra !== '' ? pack('vv', 0x0001, strlen($zip64Extra)).$zip64Extra : '')
            .self::timestampExtra($mtime);
        $sizeField = $zip64 ? self::MAX_32 : $size;

        $record = pack(
            'VvvvvvvVVVvvvvvVV',
            0x02014B50, self::VERSION_MADE_BY, $zip64Extra !== '' ? self::VERSION_ZIP64 : self::VERSION_DEFAULT,
            $flags, 0, $time, $date, $crc, $sizeField, $sizeField,
            strlen($name), strlen($extra), 0, 0, 0, $externalAttributes,
            $offsetOverflows ? self::MAX_32 : $offset,
        ).$name.$extra;

        $this->central->fwrite($record);
        $this->centralSize += strlen($record);
        $this->entries++;
    }

    private function emit(string $bytes): void
    {
        ($this->sink)($bytes);
        $this->offset += strlen($bytes);
    }

    /** Extended timestamp extra field (0x5455) with the modification time. */
    private static function timestampExtra(int $mtime): string
    {
        return pack('vvCV', 0x5455, 5, 1, max(0, min($mtime, 0x7FFFFFFF)));
    }

    /**
     * MS-DOS time and date (two-second resolution, no zone). Before 1980 the
     * format cannot say, so those clamp to 1980-01-01.
     *
     * @return array{0: int, 1: int}
     */
    private static function dosTime(int $mtime): array
    {
        $parts = getdate(max($mtime, 315532800));
        if ($parts['year'] < 1980) {
            return [0, (1 << 5) | 1];
        }

        return [
            ($parts['hours'] << 11) | ($parts['minutes'] << 5) | intdiv($parts['seconds'], 2),
            (($parts['year'] - 1980) << 9) | ($parts['mon'] << 5) | $parts['mday'],
        ];
    }
}
