<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarRsvpRateLimiter;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

final class CalendarRsvpRateLimiterTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['cache.default' => 'array']);
        Cache::flush();
    }

    public function test_blocks_after_token_limit(): void
    {
        $limiter = $this->app->make(CalendarRsvpRateLimiter::class);

        for ($i = 0; $i < 10; $i++) {
            $this->assertTrue($limiter->allow('203.0.113.9', 'abc'), "attempt {$i} should be allowed");
        }

        $this->assertFalse($limiter->allow('203.0.113.9', 'abc'));
        $this->assertTrue($limiter->allow('203.0.113.9', 'other-token'));
    }
}
