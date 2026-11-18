<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\Timing\RequestTimings;
use App\Support\Timing\TimedFilesystemAdapter;
use League\Flysystem\Config;
use League\Flysystem\Local\LocalFilesystemAdapter;
use PHPUnit\Framework\TestCase;

final class RequestTimingsTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir().'/wgw-timings-'.bin2hex(random_bytes(4));
        mkdir($this->root);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->root.'/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->root);
        parent::tearDown();
    }

    public function test_a_method_gets_the_database_and_storage_time_spent_inside_it(): void
    {
        $timings = new RequestTimings(microtime(true));
        $timings->addQuery(5.0);

        $result = $timings->method('FileNode/set', function () use ($timings): string {
            $timings->addQuery(40.0);
            $timings->addQuery(2.4);
            $timings->addStorage(30_000_000);

            return 'done';
        });

        $this->assertSame('done', $result);
        $summary = $timings->summary();
        $this->assertSame(47, $summary['db_ms']);
        $this->assertSame(3, $summary['db_queries']);
        $this->assertSame(30, $summary['storage_ms']);
        $this->assertSame(1, $summary['storage_ops']);
        $this->assertSame('FileNode/set', $summary['methods'][0]['name']);
        $this->assertSame(42, $summary['methods'][0]['db_ms']);
        $this->assertSame(30, $summary['methods'][0]['storage_ms']);
    }

    public function test_a_method_that_throws_is_still_recorded(): void
    {
        $timings = new RequestTimings(microtime(true));

        try {
            $timings->method('Blob/upload', fn () => throw new \RuntimeException('boom'));
        } catch (\RuntimeException) {
        }

        $this->assertSame(['Blob/upload'], array_column($timings->summary()['methods'], 'name'));
    }

    public function test_commit_time_counts_as_database_time(): void
    {
        $timings = new RequestTimings(microtime(true));

        $timings->commitStarting('wgw');
        usleep(20_000);
        $timings->commitFinished('wgw');
        // A commit that never started (another connection) adds nothing.
        $timings->commitFinished('other');

        $summary = $timings->summary();
        $this->assertGreaterThanOrEqual(19, $summary['db_commit_ms']);
        $this->assertSame($summary['db_commit_ms'], $summary['db_ms']);
        $this->assertSame(0, $summary['db_queries']);
    }

    public function test_other_is_what_database_and_storage_leave_of_the_whole_request(): void
    {
        $timings = new RequestTimings(microtime(true) - 3.0);
        $timings->addQuery(1000.0);
        $timings->addStorage(500_000_000);

        $summary = $timings->summary();
        $this->assertGreaterThanOrEqual(3000, $summary['ms']);
        $this->assertSame($summary['ms'] - 1500, $summary['other_ms']);
    }

    public function test_the_disk_wrapper_times_each_operation_and_a_listing_once(): void
    {
        $timings = new RequestTimings(microtime(true));
        $disk = new TimedFilesystemAdapter(new LocalFilesystemAdapter($this->root), $timings);

        $disk->write('a.txt', 'alpha', new Config);
        $disk->write('b.txt', 'beta', new Config);
        $this->assertSame('alpha', $disk->read('a.txt'));
        $this->assertTrue($disk->fileExists('b.txt'));
        $listed = iterator_to_array($disk->listContents('', false), false);
        $disk->move('b.txt', 'c.txt', new Config);
        $this->assertSame(hash('sha256', 'alpha'), $disk->checksum('a.txt', new Config(['checksum_algo' => 'sha256'])));

        $this->assertCount(2, $listed);
        $this->assertSame(7, $timings->summary()['storage_ops']);
        $this->assertTrue(is_file($this->root.'/c.txt'));
    }
}
