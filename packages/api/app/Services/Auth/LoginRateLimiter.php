<?php

declare(strict_types=1);

namespace App\Services\Auth;

use Illuminate\Cache\RateLimiter;

final class LoginRateLimiter
{
    private const int IP_LIMIT = 40;

    private const int USER_IP_LIMIT = 8;

    /** @var int Sliding window equivalent: 10 minutes */
    private const int DECAY_SECONDS = 600;

    public function __construct(private RateLimiter $rateLimiter) {}

    public function allow(string $username, string $ip): bool
    {
        if ($this->isDisabled()) {
            return true;
        }

        $ipNorm = $this->normalizeIp($ip);
        $user = $this->normalizeUser($username);
        $ipKey = $this->ipKey($ipNorm);
        $userIpKey = $this->userIpKey($user, $ipNorm);

        if ($this->rateLimiter->tooManyAttempts($ipKey, self::IP_LIMIT)) {
            return false;
        }
        if ($this->rateLimiter->tooManyAttempts($userIpKey, self::USER_IP_LIMIT)) {
            return false;
        }

        $this->rateLimiter->hit($ipKey, self::DECAY_SECONDS);
        $this->rateLimiter->hit($userIpKey, self::DECAY_SECONDS);

        return true;
    }

    public function reset(string $username, string $ip): void
    {
        if ($this->isDisabled()) {
            return;
        }

        $this->rateLimiter->clear(
            $this->userIpKey($this->normalizeUser($username), $this->normalizeIp($ip))
        );
    }

    private function isDisabled(): bool
    {
        if (app()->environment('local')) {
            return true;
        }

        $raw = strtolower(trim((string) env('WGW_DISABLE_LOGIN_THROTTLE', '')));

        return in_array($raw, ['1', 'true', 'yes', 'on'], true);
    }

    private function ipKey(string $ipNorm): string
    {
        return 'api-login-ip:'.$ipNorm;
    }

    private function userIpKey(string $user, string $ipNorm): string
    {
        return 'api-login-user:'.$user.':ip:'.$ipNorm;
    }

    private function normalizeIp(string $ip): string
    {
        $ip = trim($ip);

        return $ip !== '' ? $ip : 'unknown';
    }

    private function normalizeUser(string $username): string
    {
        $user = strtolower(trim($username));

        return $user !== '' ? $user : 'unknown';
    }
}
