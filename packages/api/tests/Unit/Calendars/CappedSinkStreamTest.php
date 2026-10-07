<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CappedSinkStream;
use GuzzleHttp\Psr7\Utils;
use PHPUnit\Framework\TestCase;

final class CappedSinkStreamTest extends TestCase
{
    public function test_writes_under_the_cap_pass_through(): void
    {
        $inner = Utils::streamFor($this->tempStream());
        $sink = new CappedSinkStream($inner, 4);

        $this->assertSame(4, $sink->write('abcd'));
        $this->assertFalse($sink->tooLarge);
        $inner->rewind();
        $this->assertSame('abcd', (string) $inner);
    }

    public function test_the_write_that_crosses_the_cap_returns_zero(): void
    {
        $inner = Utils::streamFor($this->tempStream());
        $sink = new CappedSinkStream($inner, 4);

        $this->assertSame(3, $sink->write('abc'));
        $this->assertSame(0, $sink->write('de'));
        $this->assertTrue($sink->tooLarge);
        $inner->rewind();
        $this->assertSame('abc', (string) $inner);
    }

    /**
     * @return resource
     */
    private function tempStream()
    {
        $temp = fopen('php://temp', 'w+');
        $this->assertIsResource($temp);

        return $temp;
    }
}
