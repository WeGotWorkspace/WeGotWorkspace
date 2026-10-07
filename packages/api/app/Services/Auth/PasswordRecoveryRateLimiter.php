<?php

declare(strict_types=1);

namespace App\Services\Auth;

use Illuminate\Cache\RateLimiter;

final class PasswordRecoveryRateLimiter
{
    private const int IP_LIMIT = 40;

    private const int USER_IP_LIMIT = 8;

    /** @var int Sliding window equivalent: 10 minutes */
    private const int DECAY_SECONDS = 600;

    public function __construct(private RateLimiter $rateLimiter) {}

    public function allow(string $identifier, string $ip): bool
    {
        if ($this->isDisabled()) {
            return true;
        }

        $ipNorm = $this->normalizeIp($ip);
        $id = $this->normalizeIdentifier($identifier);
        $ipKey = $this->ipKey($ipNorm);
        $idIpKey = $this->identifierIpKey($id, $ipNorm);

        if ($this->rateLimiter->tooManyAttempts($ipKey, self::IP_LIMIT)) {
            return false;
        }
        if ($this->rateLimiter->tooManyAttempts($idIpKey, self::USER_IP_LIMIT)) {
            return false;
        }

        $this->rateLimiter->hit($ipKey, self::DECAY_SECONDS);
        $this->rateLimiter->hit($idIpKey, self::DECAY_SECONDS);

        return true;
    }

    private function isDisabled(): bool
    {
        $raw = strtolower(trim((string) env('WGW_DISABLE_LOGIN_THROTTLE', '')));

        return in_array($raw, ['1', 'true', 'yes', 'on'], true);
    }

    private function ipKey(string $ipNorm): string
    {
        return 'api-password-reset-ip:'.$ipNorm;
    }

    private function identifierIpKey(string $identifier, string $ipNorm): string
    {
        return 'api-password-reset-id:'.$identifier.':ip:'.$ipNorm;
    }

    private function normalizeIp(string $ip): string
    {
        $ip = trim($ip);

        return $ip !== '' ? $ip : 'unknown';
    }

    private function normalizeIdentifier(string $identifier): string
    {
        $id = strtolower(trim($identifier));

        return $id !== '' ? $id : 'unknown';
    }
}
