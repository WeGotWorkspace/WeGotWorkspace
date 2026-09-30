<?php

declare(strict_types=1);

namespace Tests\Unit\Update;

use App\Services\Update\UpdateRunnerFilesystem;
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
        $runner = $this->app->make(UpdateRunnerFilesystem::class);
        $method = new ReflectionMethod(UpdateRunnerFilesystem::class, 'parseQuotaSizeToken');
        $method->setAccessible(true);

        $this->assertSame(1024, $method->invoke($runner, '1K'));
        $this->assertSame(1024 * 1024, $method->invoke($runner, '1M'));
        $this->assertNull($method->invoke($runner, 'nope'));
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
