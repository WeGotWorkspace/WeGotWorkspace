<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Services\Jmap\Blobs\StorageFullException;
use App\Services\Jmap\JmapMethodDispatcher;
use App\Services\Jmap\JmapRequestContext;
use App\Services\Jmap\Methods\JmapMethodInterface;
use PHPUnit\Framework\TestCase;

/**
 * The per-batch memory of {@see JmapRequestContext} (#2063): reads share one value, a write
 * never sees a value a read cached, and nothing is remembered outside a batch.
 */
final class JmapBatchMemoryTest extends TestCase
{
    private const URN = 'urn:test:memory';

    private int $computed = 0;

    private JmapRequestContext $context;

    private JmapMethodDispatcher $dispatcher;

    protected function setUp(): void
    {
        parent::setUp();
        $this->context = new JmapRequestContext;
        $remember = fn (): int => $this->context->remember('k', fn (): int => ++$this->computed);
        $this->dispatcher = new JmapMethodDispatcher(
            [FakeGetMethod::class, FakeSetMethod::class, FakeBoomMethod::class],
            static fn (string $class): JmapMethodInterface => new $class($remember),
            $this->context,
        );
    }

    public function test_reads_in_one_batch_share_the_remembered_value(): void
    {
        $responses = $this->dispatch(['X/get', 'X/get', 'X/get']);

        $this->assertSame([1, 1, 1], array_map(static fn (array $r): int => $r[1]['value'], $responses));
    }

    public function test_a_write_never_sees_a_value_a_read_cached(): void
    {
        $responses = $this->dispatch(['X/get', 'X/set', 'X/get']);

        $this->assertSame(1, $responses[0][1]['value']);
        $this->assertSame(2, $responses[1][1]['value'], 'The write must compute afresh (ifInState, oldState).');
        $this->assertSame(3, $responses[2][1]['value'], 'A read after the write must compute afresh.');
    }

    public function test_nothing_is_remembered_outside_a_batch(): void
    {
        $this->dispatch(['X/get']);

        $this->assertSame(2, $this->context->remember('k', fn (): int => ++$this->computed));
        $this->assertSame(3, $this->context->remember('k', fn (): int => ++$this->computed));
    }

    public function test_the_batch_ends_when_a_call_throws_past_the_dispatcher(): void
    {
        try {
            $this->dispatch(['X/get', 'X/boom']);
            $this->fail('The storage-full error must leave the dispatcher.');
        } catch (StorageFullException) {
        }

        $this->assertSame(2, $this->context->remember('k', fn (): int => ++$this->computed));
    }

    /**
     * @param  list<string>  $names
     * @return list<array{0: string, 1: array<string, mixed>, 2: string}>
     */
    private function dispatch(array $names): array
    {
        $calls = [];
        foreach ($names as $i => $name) {
            $calls[] = [$name, [], 'c'.$i];
        }

        return $this->dispatcher->dispatch('bob', [self::URN], $calls);
    }
}

/** A read: answers the remembered value. */
class FakeGetMethod implements JmapMethodInterface
{
    /** @param  \Closure(): int  $remember */
    public function __construct(private readonly \Closure $remember) {}

    public static function name(): string
    {
        return 'X/get';
    }

    public static function capability(): string
    {
        return 'urn:test:memory';
    }

    public function requiresAccountId(): bool
    {
        return false;
    }

    /** @return array{value: int} */
    public function handle(string $username, array $args): array
    {
        return ['value' => ($this->remember)()];
    }
}

/** A write: the dispatcher must hand it a fresh value. */
final class FakeSetMethod extends FakeGetMethod
{
    public static function name(): string
    {
        return 'X/set';
    }
}

/** A write that fails the whole request (storage full). */
final class FakeBoomMethod extends FakeGetMethod
{
    public static function name(): string
    {
        return 'X/boom';
    }

    public function handle(string $username, array $args): array
    {
        throw new StorageFullException('full');
    }
}
