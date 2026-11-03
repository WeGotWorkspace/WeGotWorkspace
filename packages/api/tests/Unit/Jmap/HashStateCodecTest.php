<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Services\Jmap\Blobs\HashStateCodec;
use PHPUnit\Framework\TestCase;

/**
 * The serialized HashContext round-trips on this build and every unusable
 * value reads back as null (never false, never a throw) — #1500.
 */
final class HashStateCodecTest extends TestCase
{
    public function test_round_trip_continues_the_running_hash(): void
    {
        $context = hash_init('sha256');
        hash_update($context, 'first half, ');
        $encoded = HashStateCodec::encode($context);

        $this->assertLessThan(1024, strlen($encoded['state']));
        $restored = HashStateCodec::decode($encoded['state'], $encoded['build']);
        $this->assertInstanceOf(\HashContext::class, $restored);
        hash_update($restored, 'second half');

        $this->assertSame(hash('sha256', 'first half, second half'), hash_final($restored));
    }

    public function test_state_from_another_build_is_not_read(): void
    {
        $encoded = HashStateCodec::encode(hash_init('sha256'));

        $this->assertNull(HashStateCodec::decode($encoded['state'], '8.3.0|x86_64|8'));
        $this->assertNull(HashStateCodec::decode($encoded['state'], null));
    }

    public function test_corrupt_state_is_null_without_a_warning(): void
    {
        $build = HashStateCodec::build();
        $warnings = [];
        set_error_handler(static function (int $no, string $message) use (&$warnings): bool {
            $warnings[] = $message;

            return true;
        });
        try {
            $this->assertNull(HashStateCodec::decode(base64_encode('O:11:"HashContext":1:{garbage'), $build));
        } finally {
            restore_error_handler();
        }
        $this->assertSame([], $warnings);

        $this->assertNull(HashStateCodec::decode(base64_encode('O:11:"HashContext":garbage'), $build));
        $this->assertNull(HashStateCodec::decode('%%% not base64 %%%', $build));
        $this->assertNull(HashStateCodec::decode('', $build));
    }

    public function test_a_value_that_is_not_a_hash_context_is_null(): void
    {
        $build = HashStateCodec::build();

        $this->assertNull(HashStateCodec::decode(base64_encode(serialize(['not' => 'a context'])), $build));
        $this->assertNull(HashStateCodec::decode(base64_encode(serialize(new \ArrayObject([1]))), $build));
    }
}
