<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use Illuminate\Cache\RateLimiter;

final class CalendarRsvpRateLimiter
{
    private const int IP_LIMIT = 30;

    private const int TOKEN_LIMIT = 10;

    private const int DECAY_SECONDS = 3600;

    public function __construct(private RateLimiter $rateLimiter) {}

    public function allow(string $ip, string $token): bool
    {
        $ipKey = 'calendar-rsvp-ip:'.$this->normalizeIp($ip);
        $tokenKey = 'calendar-rsvp-token:'.strtolower(trim($token));

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
