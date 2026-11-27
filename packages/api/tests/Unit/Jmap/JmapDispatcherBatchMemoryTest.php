<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Services\Jmap\JmapMethodDispatcher;
use App\Services\Jmap\JmapRequestContext;
use App\Services\Jmap\Methods\JmapMethodInterface;
use PHPUnit\Framework\TestCase;

/**
 * A write call in a batch reads fresh state, never what an earlier read in
 * the same batch remembered (#2063).
 */
final class JmapDispatcherBatchMemoryTest extends TestCase
{
    public function test_a_set_after_a_get_sees_a_freshly_computed_value(): void
    {
        $context = new JmapRequestContext;
        $counter = 0;
        $compute = function () use (&$counter): int {
            return ++$counter;
        };
        $dispatcher = new JmapMethodDispatcher(
            [BatchMemoryGetFake::class, BatchMemorySetFake::class],
            fn (string $class): JmapMethodInterface => new $class($context, $compute),
            $context,
        );

        $responses = $dispatcher->dispatch('u', ['urn:test:memory'], [
            ['Memory/get', [], 'a'],
            ['Memory/get', [], 'b'],
            ['Memory/set', [], 'c'],
        ]);

        $this->assertSame(1, $responses[0][1]['value']);
        $this->assertSame(1, $responses[1][1]['value']);
        $this->assertSame(2, $responses[2][1]['value']);
    }
}

abstract class BatchMemoryFake implements JmapMethodInterface
{
    public function __construct(private readonly JmapRequestContext $context, private readonly \Closure $compute) {}

    public static function capability(): string
    {
        return 'urn:test:memory';
    }

    public function requiresAccountId(): bool
    {
        return false;
    }

    public function handle(string $username, array $args): array
    {
        return ['value' => $this->context->remember('k', $this->compute)];
    }
}

final class BatchMemoryGetFake extends BatchMemoryFake
{
    public static function name(): string
    {
        return 'Memory/get';
    }
}

final class BatchMemorySetFake extends BatchMemoryFake
{
    public static function name(): string
    {
        return 'Memory/set';
    }
}
