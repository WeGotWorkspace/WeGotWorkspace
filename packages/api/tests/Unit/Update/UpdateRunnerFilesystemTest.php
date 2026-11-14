<?php

declare(strict_types=1);

namespace Tests\Unit\Update;

use App\Services\Update\HostingQuotaProbe;
use App\Services\Update\UpdateRunnerFilesystem;
use Illuminate\Support\Facades\Cache;
use ReflectionMethod;
use Tests\TestCase;

final class UpdateRunnerFilesystemTest extends TestCase
{
    public function test_format_byte_count(): void
    {
        $runner = $this->app->make(UpdateRunnerFilesystem::class);
        $method = new ReflectionMethod(UpdateRunnerFilesystem::class, 'formatByteCount');
        $method->setAccessible(true);

        $this->assertSame('0 B', $method->invoke($runner, 0));
        $this->assertSame('512 B', $method->invoke($runner, 512));
        $this->assertSame('1.0 KB', $method->invoke($runner, 1024));
    }

    public function test_parse_quota_size_token(): void
    {
        $this->assertSame(1024, HostingQuotaProbe::parseSizeToken('1K'));
        $this->assertSame(1024 * 1024, HostingQuotaProbe::parseSizeToken('1M'));
        $this->assertNull(HostingQuotaProbe::parseSizeToken('nope'));
    }

    public function test_applying_reads_the_quota_fresh_even_when_a_poll_cached_it(): void
    {
        $root = sys_get_temp_dir().'/wgw-quota-'.uniqid('', true);
        mkdir($root.'/source', 0775, true);
        mkdir($root.'/target', 0775, true);
        file_put_contents($root.'/source/index.php', str_repeat('x', 4096));
        $log = $root.'/runs.log';
        // 2 GiB used of a 2 GiB limit: nothing left.
        $this->app->instance(HostingQuotaProbe::class, new HostingQuotaProbe(
            'echo run >> '.escapeshellarg($log).'; echo "  /dev/sda1  2048M  2048M  2048M"'
        ));
        Cache::put(HostingQuotaProbe::CACHE_KEY, ['bytes' => 10 * 1024 * 1024 * 1024], HostingQuotaProbe::CACHE_SECONDS);
        $runner = $this->app->make(UpdateRunnerFilesystem::class);

        try {
            $runner->assertApplyCapacity($root.'/source', $root.'/target', ['index.php']);
            $this->fail('A full quota must stop the update.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('quota: 0 B', $e->getMessage());
        } finally {
            $runner->rmRecursive($root);
        }
        // The fresh answer replaces the cached one for the next poll.
        $this->assertSame(['bytes' => 0], Cache::get(HostingQuotaProbe::CACHE_KEY));
    }

    public function test_rm_recursive_removes_nested_trees_and_ignores_missing_paths(): void
    {
        $runner = $this->app->make(UpdateRunnerFilesystem::class);
        $root = sys_get_temp_dir().'/wgw-fs-'.uniqid('', true);
        mkdir($root.'/nested', 0775, true);
        file_put_contents($root.'/nested/file.txt', 'x');

        $runner->rmRecursive($root);
        $runner->rmRecursive($root.'/does-not-exist');

        $this->assertDirectoryDoesNotExist($root);
    }

    public function test_capacity_checks_report_disk_and_allow_a_small_tree(): void
    {
        $runner = $this->app->make(UpdateRunnerFilesystem::class);
        $root = sys_get_temp_dir().'/wgw-cap-'.uniqid('', true);
        mkdir($root.'/source', 0775, true);
        mkdir($root.'/target', 0775, true);
        file_put_contents($root.'/source/index.php', '<?php ');
        file_put_contents($root.'/target/index.php', '<?php ');

        $checks = $runner->capacityChecks($root.'/target');
        $this->assertNotEmpty($checks);
        $this->assertArrayHasKey('ok', $checks[0]);
        $this->assertArrayHasKey('label', $checks[0]);
        $this->assertArrayHasKey('detail', $checks[0]);

        $runner->assertApplyCapacity($root.'/source', $root.'/target', ['index.php']);

        $runner->rmRecursive($root);
    }
}
