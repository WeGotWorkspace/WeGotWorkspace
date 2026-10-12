<?php

declare(strict_types=1);

namespace App\Services\Auth;

use Illuminate\Cache\RateLimiter;

final class LoginRateLimiter
{
    public const int IP_LIMIT = 40;

    public const int USER_IP_LIMIT = 8;

    public const int USER_LIMIT = 30;

    public const int PROTOCOL_IP_LIMIT = 60;

    public const int PROTOCOL_USER_IP_LIMIT = 10;

    /** @var int Sliding window equivalent: 10 minutes */
    public const int DECAY_SECONDS = 600;

    /** @var int Per-user ceiling across source IPs: 15 minutes */
    public const int USER_DECAY_SECONDS = 900;

    public function __construct(private RateLimiter $rateLimiter) {}

    public function allow(string $username, string $ip): bool
    {
        if ($this->isDisabled()) {
            return true;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);

        return ! $this->tooMany($this->ipKey($ipNorm), self::IP_LIMIT)
            && ! $this->tooMany($this->userIpKey($user, $ipNorm), self::USER_IP_LIMIT)
            && ! $this->tooMany($this->userKey($user), self::USER_LIMIT);
    }

    public function hit(string $username, string $ip): void
    {
        if ($this->isDisabled()) {
            return;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);
        $this->rateLimiter->hit($this->ipKey($ipNorm), self::DECAY_SECONDS);
        $this->rateLimiter->hit($this->userIpKey($user, $ipNorm), self::DECAY_SECONDS);
        $this->rateLimiter->hit($this->userKey($user), self::USER_DECAY_SECONDS);
    }

    /**
     * DAV and Meet Basic auth. Separate per-IP and per-user+IP keys so a
     * polling client does not lock the web login. The per-user ceiling is shared.
     */
    public function allowProtocol(string $username, string $ip): bool
    {
        if ($this->isDisabled()) {
            return true;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);

        return ! $this->tooMany($this->protocolIpKey($ipNorm), self::PROTOCOL_IP_LIMIT)
            && ! $this->tooMany($this->protocolUserIpKey($user, $ipNorm), self::PROTOCOL_USER_IP_LIMIT)
            && ! $this->tooMany($this->userKey($user), self::USER_LIMIT);
    }

    public function hitProtocol(string $username, string $ip): void
    {
        if ($this->isDisabled()) {
            return;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);
        $this->rateLimiter->hit($this->protocolIpKey($ipNorm), self::DECAY_SECONDS);
        $this->rateLimiter->hit($this->protocolUserIpKey($user, $ipNorm), self::DECAY_SECONDS);
        $this->rateLimiter->hit($this->userKey($user), self::USER_DECAY_SECONDS);
    }

    public function protocolRetryAfter(string $username, string $ip): int
    {
        if ($this->isDisabled()) {
            return 1;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);

        return max(
            1,
            $this->rateLimiter->availableIn($this->protocolIpKey($ipNorm)),
            $this->rateLimiter->availableIn($this->protocolUserIpKey($user, $ipNorm)),
            $this->rateLimiter->availableIn($this->userKey($user)),
        );
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

    private function tooMany(string $key, int $limit): bool
    {
        return $this->rateLimiter->tooManyAttempts($key, $limit);
    }

    private function isDisabled(): bool
    {
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

    private function userKey(string $user): string
    {
        return 'api-login-user:'.$user;
    }

    private function protocolIpKey(string $ipNorm): string
    {
        return 'dav-login-ip:'.$ipNorm;
    }

    private function protocolUserIpKey(string $user, string $ipNorm): string
    {
        return 'dav-login-user:'.$user.':ip:'.$ipNorm;
    }

    /**
     * @return array{string, string}
     */
    private function normalized(string $username, string $ip): array
    {
        return [$this->normalizeUser($username), $this->normalizeIp($ip)];
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
