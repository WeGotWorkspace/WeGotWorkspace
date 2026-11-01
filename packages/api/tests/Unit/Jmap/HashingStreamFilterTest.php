<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Storage\Local\LocalDiskFiles;
use App\Storage\Streams\HashingStreamFilter;
use App\Storage\Streams\StreamDigest;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Hash-while-streaming (#1500): Flysystem writes the bytes and the filter
 * sees each one once; a limit stops the write and flags the overflow.
 */
final class HashingStreamFilterTest extends TestCase
{
    public function test_flysystem_write_stream_is_hashed_while_written(): void
    {
        $disk = Storage::fake('wgw_data');
        $source = $this->stream(str_repeat('abc', 400_000));
        $digest = new StreamDigest;
        HashingStreamFilter::attach($source, $digest);

        $disk->writeStream('part', $source);
        fclose($source);

        $this->assertSame(1_200_000, $digest->bytes);
        $this->assertSame(hash('sha256', str_repeat('abc', 400_000)), $digest->hex());
        $this->assertSame(1_200_000, $disk->size('part'));
    }

    public function test_limit_flags_overflow_and_stops_passing_data(): void
    {
        $disk = Storage::fake('wgw_data');
        $source = $this->stream(str_repeat('x', 3 * 1024 * 1024));
        $digest = new StreamDigest(1024 * 1024);
        HashingStreamFilter::attach($source, $digest);

        $disk->writeStream('part', $source);

        $this->assertTrue($digest->overflowed);
        $this->assertLessThanOrEqual(1024 * 1024, $disk->size('part'));
    }

    public function test_local_disk_files_append_truncate_and_move_across(): void
    {
        $data = Storage::fake('wgw_data');
        $files = Storage::fake('wgw_files');
        $local = new LocalDiskFiles;

        $this->assertTrue($local->isLocal($data));
        $this->assertSame(5, $local->append($data, 'a/b', $this->stream('hello')));
        $this->assertSame(3, $local->append($data, 'a/b', $this->stream('worlds'), 3));
        $this->assertSame('hellowor', $data->get('a/b'));

        $local->truncate($data, 'a/b', 5);
        $this->assertSame('hello', $data->get('a/b'));

        $this->assertTrue($local->moveAcross($data, 'a/b', $files, 'users/bob/hello.txt'));
        $this->assertFalse($data->exists('a/b'));
        $this->assertSame('hello', $files->get('users/bob/hello.txt'));
    }

    /**
     * @return resource
     */
    private function stream(string $contents)
    {
        $stream = fopen('php://temp', 'w+b');
        $this->assertIsResource($stream);
        fwrite($stream, $contents);
        rewind($stream);

        return $stream;
    }
}
