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
     * @return list<array{name: string, flags: int, mtime: int|null, versionNeeded: int}>
     */
    public static function centralRecords(string $bytes): array
    {
        $records = [];
        $at = 0;
        while (($at = strpos($bytes, "PK\x01\x02", $at)) !== false) {
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
