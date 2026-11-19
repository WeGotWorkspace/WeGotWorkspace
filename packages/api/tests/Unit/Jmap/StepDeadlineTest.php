<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Services\Jmap\Assembly\StepDeadline;
use App\Services\Jmap\Assembly\StepHasher;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Wall-time budget of one assembly step (#2249): a deadline that has passed
 * still lets a hashing step read one chunk, so every call moves on.
 */
final class StepDeadlineTest extends TestCase
{
    private const MIB = 1024 * 1024;

    public function test_a_deadline_passes_after_its_seconds(): void
    {
        $this->assertFalse(StepDeadline::in(60)->passed());
        $this->assertTrue(StepDeadline::in(0)->passed());

        $this->assertTrue(StepDeadline::in(60)->passesWithin(61));
        $this->assertFalse(StepDeadline::in(60)->passesWithin(30));

        $short = StepDeadline::in(0.02);
        $this->assertFalse($short->passed());
        usleep(30_000);
        $this->assertTrue($short->passed());
    }

    public function test_hashing_stops_after_the_chunk_in_which_the_deadline_passed(): void
    {
        $disk = Storage::fake('step-deadline');
        $bytes = random_bytes(3 * self::MIB);
        $disk->put('file.bin', $bytes);

        $context = hash_init('sha256');
        $offset = StepHasher::advance($disk, 'file.bin', $context, 0, strlen($bytes), strlen($bytes), StepDeadline::in(0));
        $this->assertSame(self::MIB, $offset);

        $offset = StepHasher::advance($disk, 'file.bin', $context, $offset, strlen($bytes), strlen($bytes), StepDeadline::in(60));
        $this->assertSame(strlen($bytes), $offset);
        $this->assertSame(hash('sha256', $bytes), hash_final($context));
    }
}
