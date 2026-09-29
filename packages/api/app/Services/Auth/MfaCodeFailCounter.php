<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\AuthChallenge;
use Illuminate\Cache\RateLimiter;

/**
 * Failed TOTP and recovery codes for one username, across IP addresses.
 *
 * Ten failed codes lock the username for an hour and delete open challenges.
 * A later correct code stays refused until the window ends and a sign-in
 * issues tokens.
 */
final class MfaCodeFailCounter
{
    public const int LIMIT = 10;

    private const int DECAY_SECONDS = 3600;

    public function __construct(private RateLimiter $rateLimiter) {}

    public function isLocked(string $username): bool
    {
        return $this->rateLimiter->tooManyAttempts($this->key($username), self::LIMIT);
    }

    /**
     * Record one failed code. Returns true when this failure trips the lock.
     */
    public function recordFailure(string $username): bool
    {
        $username = $this->normalize($username);
        $key = $this->key($username);
        if ($this->rateLimiter->tooManyAttempts($key, self::LIMIT)) {
            return true;
        }

        $this->rateLimiter->hit($key, self::DECAY_SECONDS);
        if ($this->rateLimiter->attempts($key) >= self::LIMIT) {
            AuthChallenge::query()->where('username', $username)->delete();

            return true;
        }

        return false;
    }

    public function clear(string $username): void
    {
        $this->rateLimiter->clear($this->key($username));
    }

    private function key(string $username): string
    {
        return 'mfa-code-fail:'.$this->normalize($username);
    }

    private function normalize(string $username): string
    {
        $user = strtolower(trim($username));

        return $user !== '' ? $user : 'unknown';
    }
}
