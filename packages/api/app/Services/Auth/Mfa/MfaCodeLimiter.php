<?php

declare(strict_types=1);

namespace App\Services\Auth\Mfa;

use App\Models\AuthChallenge;
use App\Services\Auth\LoginRateLimiter;
use Illuminate\Cache\RateLimiter;

/**
 * One counter per user for failed authenticator and recovery codes, in the
 * shared cache store. Ten failures pause code entry for that user for an hour,
 * a later correct code included, and end that user's open challenges. A correct
 * code does not reset it: the counter only decays.
 */
final class MfaCodeLimiter
{
    public const int LIMIT = 10;

    public const int DECAY_SECONDS = 3600;

    public function __construct(private RateLimiter $rateLimiter) {}

    public function assertNotLocked(string $username): void
    {
        $key = $this->key($username);
        if ($this->rateLimiter->tooManyAttempts($key, self::LIMIT)) {
            throw LoginRateLimiter::throttled($this->rateLimiter->availableIn($key));
        }
    }

    /**
     * Counts one failed code. Throws the 429 when this failure reaches the limit.
     */
    public function recordFailure(string $username): void
    {
        $key = $this->key($username);
        $this->rateLimiter->hit($key, self::DECAY_SECONDS);
        if ($this->rateLimiter->attempts($key) >= self::LIMIT) {
            AuthChallenge::query()->where('username', $this->user($username))->delete();
            throw LoginRateLimiter::throttled($this->rateLimiter->availableIn($key));
        }
    }

    private function key(string $username): string
    {
        return 'mfa-code-fail:'.$this->user($username);
    }

    private function user(string $username): string
    {
        $user = strtolower(trim($username));

        return $user !== '' ? $user : 'unknown';
    }
}
