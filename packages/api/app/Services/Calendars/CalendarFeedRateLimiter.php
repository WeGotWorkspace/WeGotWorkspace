<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use Illuminate\Cache\RateLimiter;

final class CalendarFeedRateLimiter
{
    private const int IP_LIMIT = 120;

    private const int TOKEN_LIMIT = 60;

    private const int DECAY_SECONDS = 3600;

    public function __construct(private RateLimiter $rateLimiter) {}

    public function allow(string $ip, string $token): bool
    {
        $ipKey = 'calendar-feed-ip:'.$this->normalizeIp($ip);
        $tokenKey = 'calendar-feed-token:'.strtolower(trim($token));

        if ($this->rateLimiter->tooManyAttempts($ipKey, self::IP_LIMIT)) {
            return false;
        }
        if ($token !== '' && $this->rateLimiter->tooManyAttempts($tokenKey, self::TOKEN_LIMIT)) {
            return false;
        }

        $this->rateLimiter->hit($ipKey, self::DECAY_SECONDS);
        if ($token !== '') {
            $this->rateLimiter->hit($tokenKey, self::DECAY_SECONDS);
        }

        return true;
    }

    private function normalizeIp(string $ip): string
    {
        $ip = trim($ip);

        return $ip !== '' ? $ip : 'unknown';
    }
}
