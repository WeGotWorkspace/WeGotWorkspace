<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability\PublicLink;

use App\Exceptions\ApiHttpException;
use Illuminate\Cache\RateLimiter;

/**
 * Limits for the public availability feed, all checked before the token is
 * looked up or a calendar is read. Keys are the client address and the token;
 * a caller cannot mint either beyond one address, and every guess costs the
 * address a miss.
 *
 *   per address, every request       120 / hour
 *   per address, unknown token        30 / hour
 *   per token, every request         600 / hour (many subscribers behind one fetcher)
 */
final class AvailabilityPublicFeedRateLimiter
{
    private const int IP_LIMIT = 120;

    private const int IP_MISS_LIMIT = 30;

    private const int TOKEN_LIMIT = 600;

    private const int DECAY_SECONDS = 3600;

    public function __construct(private readonly RateLimiter $limiter) {}

    /** Counts the request against the address; throws 429 when the address is over a limit. */
    public function enter(string $ip): void
    {
        $key = self::ipKey($ip);
        $missKey = self::missKey($ip);
        if ($this->limiter->tooManyAttempts($key, self::IP_LIMIT)) {
            throw self::throttled($this->limiter->availableIn($key));
        }
        if ($this->limiter->tooManyAttempts($missKey, self::IP_MISS_LIMIT)) {
            throw self::throttled($this->limiter->availableIn($missKey));
        }
        $this->limiter->hit($key, self::DECAY_SECONDS);
    }

    public function miss(string $ip): void
    {
        $this->limiter->hit(self::missKey($ip), self::DECAY_SECONDS);
    }

    /** Counts the request against a known token; throws 429 when it is over its limit. */
    public function token(string $tokenHash): void
    {
        $key = 'availability-feed-token:'.$tokenHash;
        if ($this->limiter->tooManyAttempts($key, self::TOKEN_LIMIT)) {
            throw self::throttled($this->limiter->availableIn($key));
        }
        $this->limiter->hit($key, self::DECAY_SECONDS);
    }

    private static function ipKey(string $ip): string
    {
        return 'availability-feed-ip:'.self::address($ip);
    }

    private static function missKey(string $ip): string
    {
        return 'availability-feed-miss:'.self::address($ip);
    }

    private static function address(string $ip): string
    {
        $ip = trim($ip);

        return $ip !== '' ? $ip : 'unknown';
    }

    private static function throttled(int $retryAfter): ApiHttpException
    {
        return new ApiHttpException(
            429,
            'Too many attempts. Please try again later.',
            'rate_limited',
            [],
            ['Retry-After' => max(1, $retryAfter)],
        );
    }
}
