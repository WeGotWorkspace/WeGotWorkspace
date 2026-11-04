<?php

declare(strict_types=1);

namespace Tests\Unit\Drive;

use App\Services\Drive\FolderZip\FolderZipWalker;
use App\Services\Drive\FolderZip\ZipStreamWriter;
use Tests\Support\ZipArchiveInspector;
use Tests\TestCase;

/**
 * The stored zip writer behind folder downloads (#1621), read back by
 * libzip with consistency checks.
 */
final class ZipStreamWriterTest extends TestCase
{
    private string $path = '';

    protected function tearDown(): void
    {
        if ($this->path !== '' && is_file($this->path)) {
            unlink($this->path);
        }
        parent::tearDown();
    }

    public function test_files_and_folders_round_trip_with_utf8_names_and_file_times(): void
    {
        $random = random_bytes(300_001);
        $bytes = $this->write(function (ZipStreamWriter $zip) use ($random): void {
            $zip->addDirectory('Top', 1_700_000_000);
            $zip->addDirectory('Top/Empty', 1_700_000_000);
            $zip->addFile('Top/Überblick — ñ.txt', $this->stream('hallo wereld'), 1_600_000_000, 12);
            $zip->addFile('Top/random.bin', $this->stream($random), 1_650_000_001, strlen($random));
            $zip->addFile('Top/empty.txt', $this->stream(''), 1_650_000_000, 0);
        }, 4096);

        $this->assertSame([
            'Top/' => null,
            'Top/Empty/' => null,
            'Top/Überblick — ñ.txt' => 'hallo wereld',
            'Top/random.bin' => $random,
            'Top/empty.txt' => '',
        ], ZipArchiveInspector::contents($this->path));

        $records = ZipArchiveInspector::centralRecords($bytes);
        foreach ($records as $record) {
            $this->assertSame(0x0800, $record['flags'] & 0x0800, $record['name'].' has the UTF-8 flag');
            $this->assertSame(20, $record['versionNeeded'], $record['name'].' needs no ZIP64');
        }
        $this->assertSame(1_600_000_000, $records[2]['mtime']);
        $this->assertSame(1_650_000_001, $records[3]['mtime']);
        $this->assertFalse(ZipArchiveInspector::hasZip64EndRecord($bytes), 'no ZIP64 end record for a small archive');
    }

    public function test_file_data_that_looks_like_a_central_record_does_not_confuse_the_reader(): void
    {
        // Stored file data can contain any bytes, including a central
        // directory signature followed by huge length fields.
        $tricky = 'before'."PK\x01\x02".str_repeat("\xff", 60).'after';
        $bytes = $this->write(function (ZipStreamWriter $zip) use ($tricky): void {
            $zip->addFile('Top/tricky.bin', $this->stream($tricky), 1_700_000_000, strlen($tricky));
            $zip->addFile('Top/next.txt', $this->stream('next'), 1_700_000_001, 4);
        });

        $this->assertSame(['Top/tricky.bin' => $tricky, 'Top/next.txt' => 'next'], ZipArchiveInspector::contents($this->path));
        $records = ZipArchiveInspector::centralRecords($bytes);
        $this->assertSame(['Top/tricky.bin', 'Top/next.txt'], array_column($records, 'name'));
        $this->assertSame(1_700_000_001, $records[1]['mtime']);
    }

    public function test_an_entry_of_four_gib_or_more_is_zip64_with_its_crc_in_the_local_header(): void
    {
        $bytes = $this->write(function (ZipStreamWriter $zip): void {
            $zip->addDirectory('Top', 1_700_000_000);
            $zip->addFile('Top/huge.bin', $this->stream('it shrank'), 1_700_000_000, ZipStreamWriter::ZIP64_ENTRY_THRESHOLD);
            $zip->addFile('Top/small.bin', $this->stream('small'), 1_700_000_000, 5);
        });

        $this->assertSame(['Top/' => null, 'Top/huge.bin' => 'it shrank', 'Top/small.bin' => 'small'], ZipArchiveInspector::contents($this->path));
        $records = ZipArchiveInspector::centralRecords($bytes);
        $this->assertSame(45, $records[1]['versionNeeded']);
        $this->assertSame(0, $records[1]['flags'] & 0x0008, 'no data descriptor: macOS needs the sizes up front');
        $this->assertSame(20, $records[2]['versionNeeded']);
        $this->assertSame(0x0008, $records[2]['flags'] & 0x0008);
        // The local header of huge.bin carries the CRC-32 of its bytes.
        $local = strpos($bytes, "PK\x03\x04", 1);
        $this->assertNotFalse($local);
        /** @var array{crc: int, flags: int} $header */
        $header = unpack('x6/vflags/x6/Vcrc', $bytes, (int) $local);
        $this->assertSame(crc32('it shrank'), $header['crc']);
    }

    public function test_a_large_file_rewritten_between_its_two_reads_only_spoils_its_own_entry(): void
    {
        $this->write(function (ZipStreamWriter $zip): void {
            $zip->addFile('Top/huge.bin', ChangingStream::open('first read, long', 'second'), 1_700_000_000, ZipStreamWriter::ZIP64_ENTRY_THRESHOLD);
            $zip->addFile('Top/after.txt', $this->stream('after'), 1_700_000_000, 5);
        }, 4);

        $zip = new \ZipArchive;
        $this->assertTrue($zip->open($this->path, \ZipArchive::CHECKCONS | \ZipArchive::RDONLY));
        $this->assertSame(2, $zip->numFiles);
        $stat = $zip->statName('Top/huge.bin');
        $this->assertIsArray($stat);
        $this->assertSame(16, $stat['size']);
        // Cut or zero-padded to the size of the first read, under the first read's CRC.
        $this->assertSame('second'.str_repeat("\0", 10), $zip->getFromName('Top/huge.bin'));
        $this->assertSame(crc32('first read, long'), $stat['crc']);
        $this->assertSame('after', $zip->getFromName('Top/after.txt'));
        $zip->close();
    }

    public function test_more_than_65534_entries_get_zip64_end_records(): void
    {
        $bytes = $this->write(function (ZipStreamWriter $zip): void {
            for ($i = 0; $i < 70_000; $i++) {
                $zip->addDirectory('Top/d'.$i, 1_700_000_000);
            }
            $zip->addFile('Top/last.txt', $this->stream('last'), 1_700_000_000, 4);
        });

        $this->assertStringContainsString("PK\x06\x06", $bytes);
        $this->assertStringContainsString("PK\x06\x07", $bytes);
        $zip = new \ZipArchive;
        $this->assertTrue($zip->open($this->path, \ZipArchive::CHECKCONS | \ZipArchive::RDONLY));
        $this->assertSame(70_001, $zip->numFiles);
        $this->assertSame('last', $zip->getFromName('Top/last.txt'));
        $zip->close();
    }

    public function test_memory_does_not_grow_with_the_number_of_entries(): void
    {
        $sink = static function (string $bytes): void {};
        $zip = new ZipStreamWriter($sink);
        for ($i = 0; $i < 5_000; $i++) {
            $zip->addDirectory('Top/warm-up-'.$i, 1_700_000_000);
        }
        $before = memory_get_usage();
        for ($i = 0; $i < 100_000; $i++) {
            $zip->addDirectory('Top/'.str_repeat('n', 40).$i, 1_700_000_000);
        }
        $zip->finish();

        // About 13 MB of central records went to php://temp, not to memory.
        $this->assertLessThan(2 * 1024 * 1024, memory_get_usage() - $before);
    }

    public function test_times_before_1980_clamp_and_names_collide_case_insensitively(): void
    {
        $this->write(function (ZipStreamWriter $zip): void {
            $zip->addFile('old.txt', $this->stream('old'), 0, 3);
        });
        $this->assertSame(['old.txt' => 'old'], ZipArchiveInspector::contents($this->path));

        $used = [];
        $this->assertSame('Report.txt', FolderZipWalker::uniqueName('Report.txt', false, $used));
        $this->assertSame('report (2).txt', FolderZipWalker::uniqueName('report.txt', false, $used));
        $this->assertSame('REPORT (3).TXT', FolderZipWalker::uniqueName('REPORT.TXT', false, $used));
        $this->assertSame('v1.2', FolderZipWalker::uniqueName('v1.2', true, $used));
        $this->assertSame('V1.2 (2)', FolderZipWalker::uniqueName('V1.2', true, $used));
    }

    public function test_names_are_made_safe_for_any_extractor(): void
    {
        $this->assertSame('a_b_c', FolderZipWalker::safeName('a/b\\c'));
        $this->assertSame('tab_here', FolderZipWalker::safeName("tab\there"));
        $this->assertSame('_', FolderZipWalker::safeName('..'));
        $this->assertSame('_', FolderZipWalker::safeName('  '));
        $this->assertSame('Überblick', FolderZipWalker::safeName('Überblick'));
    }

    /**
     * @param  callable(ZipStreamWriter): void  $build
     */
    private function write(callable $build, int $chunk = ZipStreamWriter::CHUNK_BYTES): string
    {
        $this->path = (string) tempnam(sys_get_temp_dir(), 'wgw-zip-');
        $out = fopen($this->path, 'wb');
        $this->assertIsResource($out);
        $zip = new ZipStreamWriter(static function (string $bytes) use ($out): void {
            fwrite($out, $bytes);
        }, $chunk);
        $build($zip);
        $zip->finish();
        fclose($out);

        return (string) file_get_contents($this->path);
    }

    /**
     * @return resource
     */
    private function stream(string $content)
    {
        $stream = fopen('php://memory', 'w+b');
        $this->assertIsResource($stream);
        fwrite($stream, $content);
        rewind($stream);

        return $stream;
    }
}

/**
 * A seekable stream that reads `first` until it is rewound, then `second`:
 * a file rewritten in place between the CRC pass and the copy pass.
 */
final class ChangingStream
{
    /** @var resource|null */
    public $context;

    /** @var array{0: string, 1: string} */
    private static array $contents = ['', ''];

    private int $position = 0;

    private int $pass = 0;

    private static bool $registered = false;

    /**
     * @return resource
     */
    public static function open(string $first, string $second)
    {
        if (! self::$registered) {
            stream_wrapper_register('wgw-changing', self::class);
            self::$registered = true;
        }
        self::$contents = [$first, $second];
        $stream = fopen('wgw-changing://file', 'rb');
        if ($stream === false) {
            throw new \RuntimeException('Cannot open the changing stream.');
        }

        return $stream;
    }

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        return true;
    }

    public function stream_read(int $count): string
    {
        $chunk = substr(self::$contents[$this->pass], $this->position, $count);
        $this->position += strlen($chunk);

        return $chunk;
    }

    public function stream_eof(): bool
    {
        return $this->position >= strlen(self::$contents[$this->pass]);
    }

    public function stream_seek(int $offset, int $whence): bool
    {
        $this->pass = 1;
        $this->position = $offset;

        return true;
    }

    public function stream_tell(): int
    {
        return $this->position;
    }

    /**
     * @return array<string, int>
     */
    public function stream_stat(): array
    {
        return ['size' => strlen(self::$contents[$this->pass])];
    }
}
