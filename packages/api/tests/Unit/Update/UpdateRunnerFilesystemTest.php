<?php

declare(strict_types=1);

namespace Tests\Unit\Update;

use App\Services\Update\UpdateRunner;
use ReflectionMethod;
use Tests\TestCase;

final class UpdateRunnerFilesystemTest extends TestCase
{
    public function test_format_byte_count(): void
    {
        $runner = $this->app->make(UpdateRunner::class);
        $method = new ReflectionMethod(UpdateRunner::class, 'formatByteCount');
        $method->setAccessible(true);

        $this->assertSame('0 B', $method->invoke($runner, 0));
        $this->assertSame('512 B', $method->invoke($runner, 512));
        $this->assertSame('1.0 KB', $method->invoke($runner, 1024));
    }

    public function test_parse_quota_size_token(): void
    {
        $runner = $this->app->make(UpdateRunner::class);
        $method = new ReflectionMethod(UpdateRunner::class, 'parseQuotaSizeToken');
        $method->setAccessible(true);

        $this->assertSame(1024, $method->invoke($runner, '1K'));
        $this->assertSame(1024 * 1024, $method->invoke($runner, '1M'));
        $this->assertNull($method->invoke($runner, 'nope'));
    }
}
