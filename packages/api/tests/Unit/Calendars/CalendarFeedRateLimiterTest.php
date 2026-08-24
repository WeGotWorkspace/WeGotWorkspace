<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarFeedRateLimiter;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

final class CalendarFeedRateLimiterTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['cache.default' => 'array']);
        Cache::flush();
    }

    public function test_blocks_after_token_limit(): void
    {
        $limiter = $this->app->make(CalendarFeedRateLimiter::class);

        for ($i = 0; $i < 60; $i++) {
            $this->assertTrue($limiter->allow('203.0.113.9', 'abc'), "attempt {$i} should be allowed");
        }

        $this->assertFalse($limiter->allow('203.0.113.9', 'abc'));
        $this->assertTrue($limiter->allow('203.0.113.9', 'other-token'));
    }
}
