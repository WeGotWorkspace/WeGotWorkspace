<?php

declare(strict_types=1);

namespace Tests\Support;

/**
 * Reads a zip the way a standard reader does (libzip with consistency
 * checks), plus the raw central records for what ZipArchive does not show:
 * general purpose flags and the extended timestamp.
 */
final class ZipArchiveInspector
{
    /**
     * Every entry name mapped to its content (null for a folder). Fails on
     * a CRC mismatch or a local/central inconsistency.
     *
     * @return array<string, string|null>
     */
    public static function contents(string $zipPath): array
    {
        $zip = new \ZipArchive;
        $opened = $zip->open($zipPath, \ZipArchive::CHECKCONS | \ZipArchive::RDONLY);
        if ($opened !== true) {
            throw new \RuntimeException('ZipArchive refused the archive: '.$opened);
        }
        $entries = [];
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = (string) $zip->getNameIndex($i);
            if (str_ends_with($name, '/')) {
                $entries[$name] = null;

                continue;
            }
            $content = $zip->getFromIndex($i);
            if ($content === false) {
                throw new \RuntimeException('Cannot read '.$name.': '.$zip->getStatusString());
            }
            $entries[$name] = $content;
        }
        $zip->close();

        return $entries;
    }

    /**
     * The central directory records, read the way a zip reader finds them:
     * from the end of central directory record (and its ZIP64 form when
     * present), never by scanning the bytes. File data can hold any byte
     * sequence, so a scan for "PK\x01\x02" can land inside a file.
     *
     * @return list<array{name: string, flags: int, mtime: int|null, versionNeeded: int}>
     */
    public static function centralRecords(string $bytes): array
    {
        [$count, $at] = self::centralDirectory($bytes);
        $records = [];
        for ($i = 0; $i < $count; $i++) {
            if (substr($bytes, $at, 4) !== "PK\x01\x02") {
                throw new \RuntimeException('No central directory record at offset '.$at);
            }
            /** @var array{needed: int, flags: int, nameLength: int, extraLength: int, commentLength: int} $head */
            $head = unpack('x4/vmadeBy/vneeded/vflags/x18/vnameLength/vextraLength/vcommentLength', $bytes, $at);
            $name = substr($bytes, $at + 46, $head['nameLength']);
            $extra = substr($bytes, $at + 46 + $head['nameLength'], $head['extraLength']);
            $records[] = [
                'name' => $name,
                'flags' => $head['flags'],
                'mtime' => self::extendedTimestamp($extra),
                'versionNeeded' => $head['needed'],
            ];
            $at += 46 + $head['nameLength'] + $head['extraLength'] + $head['commentLength'];
        }

        return $records;
    }

    /** True when the archive ends with a ZIP64 end record and locator. */
    public static function hasZip64EndRecord(string $bytes): bool
    {
        self::endRecordOffset($bytes);

        return strlen($bytes) >= 42 && substr($bytes, -42, 4) === "PK\x06\x07";
    }

    /**
     * Entry count and central directory offset, from the end records.
     *
     * @return array{0: int, 1: int}
     */
    private static function centralDirectory(string $bytes): array
    {
        $end = self::endRecordOffset($bytes);
        /** @var array{count: int, offset: int} $eocd */
        $eocd = unpack('x10/vcount/x4/Voffset', $bytes, $end);
        if (! self::hasZip64EndRecord($bytes)) {
            return [$eocd['count'], $eocd['offset']];
        }
        /** @var array{zip64End: int} $locator */
        $locator = unpack('x8/Pzip64End', $bytes, $end - 20);
        if (substr($bytes, $locator['zip64End'], 4) !== "PK\x06\x06") {
            throw new \RuntimeException('The ZIP64 locator does not point at a ZIP64 end record');
        }
        /** @var array{count: int, offset: int} $zip64 */
        $zip64 = unpack('x32/Pcount/x8/Poffset', $bytes, $locator['zip64End']);

        return [$zip64['count'], $zip64['offset']];
    }

    /** The archives under test carry no comment, so the end record is the last 22 bytes. */
    private static function endRecordOffset(string $bytes): int
    {
        $end = strlen($bytes) - 22;
        if ($end < 0 || substr($bytes, $end, 4) !== "PK\x05\x06") {
            throw new \RuntimeException('No end of central directory record in the last 22 bytes');
        }

        return $end;
    }

    private static function extendedTimestamp(string $extra): ?int
    {
        $at = 0;
        while ($at + 4 <= strlen($extra)) {
            /** @var array{id: int, size: int} $field */
            $field = unpack('vid/vsize', $extra, $at);
            if ($field['id'] === 0x5455 && $field['size'] >= 5) {
                /** @var array{1: int} $time */
                $time = unpack('V', $extra, $at + 5);

                return $time[1];
            }
            $at += 4 + $field['size'];
        }

        return null;
    }
}
