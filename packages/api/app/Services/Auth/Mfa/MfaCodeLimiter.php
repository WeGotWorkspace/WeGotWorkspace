<?php

declare(strict_types=1);

namespace App\Services\Auth\Mfa;

use App\Services\Auth\LoginRateLimiter;
use Illuminate\Cache\RateLimiter;

/**
 * One counter per user for failed authenticator and recovery codes, in the
 * shared cache store. Ten failures within an hour pause code entry for that
 * user for an hour from the tenth, a later correct code included, and end that
 * user's open challenges. A correct code does not reset the counter.
 */
final class MfaCodeLimiter
{
    public const int LIMIT = 10;

    public const int DECAY_SECONDS = 3600;

    public function __construct(
        private RateLimiter $rateLimiter,
        private AuthChallengeService $challenges,
    ) {}

    public function assertNotLocked(string $username): void
    {
        $lock = $this->lockKey($username);
        if ($this->rateLimiter->attempts($lock) > 0) {
            throw LoginRateLimiter::throttled($this->rateLimiter->availableIn($lock));
        }
    }

    /**
     * Counts one failed code. The tenth within an hour of the first locks the
     * user for a full hour from that tenth failure (a separate key, so the
     * lock does not end when the counter's first-hit timer runs out).
     */
    public function recordFailure(string $username): void
    {
        $key = $this->key($username);
        $this->rateLimiter->hit($key, self::DECAY_SECONDS);
        if ($this->rateLimiter->attempts($key) < self::LIMIT) {
            return;
        }

        $this->rateLimiter->clear($key);
        $lock = $this->lockKey($username);
        $this->rateLimiter->clear($lock);
        $this->rateLimiter->hit($lock, self::DECAY_SECONDS);
        $this->challenges->forgetUser($username);

        throw LoginRateLimiter::throttled($this->rateLimiter->availableIn($lock));
    }

    private function key(string $username): string
    {
        return 'mfa-code-fail:'.$this->user($username);
    }

    private function lockKey(string $username): string
    {
        return 'mfa-code-lock:'.$this->user($username);
    }

    private function user(string $username): string
    {
        $user = strtolower(trim($username));

        return $user !== '' ? $user : 'unknown';
    }
}
