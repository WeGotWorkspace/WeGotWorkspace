<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Cache\Repository as CacheRepository;

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

    /** @var int How long an address that completed a sign-in stays known for that user: 30 days */
    public const int KNOWN_ADDRESS_SECONDS = 2_592_000;

    public function __construct(
        private RateLimiter $rateLimiter,
        private CacheRepository $cache,
    ) {}

    public function allow(string $username, string $ip): bool
    {
        if ($this->isDisabled()) {
            return true;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);

        return ! $this->tooMany($this->ipKey($ipNorm), self::IP_LIMIT)
            && ! $this->tooMany($this->userIpKey($user, $ipNorm), self::USER_IP_LIMIT)
            && ($this->isKnown($user, $ipNorm) || ! $this->tooMany($this->userKey($user), self::USER_LIMIT));
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
     * DAV and Meet Basic auth. Separate per-IP, per-user+IP, and per-user
     * keys so a polling client does not lock the web login.
     */
    public function allowProtocol(string $username, string $ip): bool
    {
        if ($this->isDisabled()) {
            return true;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);

        return ! $this->tooMany($this->protocolIpKey($ipNorm), self::PROTOCOL_IP_LIMIT)
            && ! $this->tooMany($this->protocolUserIpKey($user, $ipNorm), self::PROTOCOL_USER_IP_LIMIT)
            && ($this->isKnown($user, $ipNorm) || ! $this->tooMany($this->protocolUserKey($user), self::USER_LIMIT));
    }

    public function hitProtocol(string $username, string $ip): void
    {
        if ($this->isDisabled()) {
            return;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);
        $this->rateLimiter->hit($this->protocolIpKey($ipNorm), self::DECAY_SECONDS);
        $this->rateLimiter->hit($this->protocolUserIpKey($user, $ipNorm), self::DECAY_SECONDS);
        $this->rateLimiter->hit($this->protocolUserKey($user), self::USER_DECAY_SECONDS);
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
            $this->isKnown($user, $ipNorm) ? 0 : $this->rateLimiter->availableIn($this->protocolUserKey($user)),
        );
    }

    /**
     * Seconds until the web sign-in keys of this user and address allow again.
     */
    public function retryAfter(string $username, string $ip): int
    {
        if ($this->isDisabled()) {
            return 1;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);

        return max(
            1,
            $this->rateLimiter->availableIn($this->ipKey($ipNorm)),
            $this->rateLimiter->availableIn($this->userIpKey($user, $ipNorm)),
            $this->isKnown($user, $ipNorm) ? 0 : $this->rateLimiter->availableIn($this->userKey($user)),
        );
    }

    /**
     * The web sign-in limit for a request that names no user, such as an unknown
     * two-factor challenge: only the address key.
     */
    public function allowIp(string $ip): bool
    {
        return $this->isDisabled() || ! $this->tooMany($this->ipKey($this->normalizeIp($ip)), self::IP_LIMIT);
    }

    public function hitIp(string $ip): void
    {
        if (! $this->isDisabled()) {
            $this->rateLimiter->hit($this->ipKey($this->normalizeIp($ip)), self::DECAY_SECONDS);
        }
    }

    public function ipRetryAfter(string $ip): int
    {
        return $this->isDisabled() ? 1 : max(1, $this->rateLimiter->availableIn($this->ipKey($this->normalizeIp($ip))));
    }

    public static function throttled(int $retryAfter): ApiHttpException
    {
        return new ApiHttpException(
            429,
            'Too many login attempts. Please try again later.',
            'throttled',
            headers: ['Retry-After' => max(1, $retryAfter)],
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

    /**
     * Record that this user completed a sign-in from this address. Call it only
     * after the last factor, never after the password alone.
     *
     * The per-user ceiling across addresses stops a password spray from many
     * addresses, but it also lets anyone lock a named account (`admin`) out
     * everywhere. A known address skips that ceiling, so the owner still gets
     * in from where they signed in before. The per-address and
     * per-user-and-address limits still apply to it.
     */
    public function rememberAddress(string $username, string $ip): void
    {
        if ($this->isDisabled()) {
            return;
        }

        [$user, $ipNorm] = $this->normalized($username, $ip);
        $this->cache->add($this->knownKey($user, $ipNorm), true, self::KNOWN_ADDRESS_SECONDS);
    }

    private function isKnown(string $user, string $ipNorm): bool
    {
        return $this->cache->has($this->knownKey($user, $ipNorm));
    }

    private function knownKey(string $user, string $ipNorm): string
    {
        return 'login-known-address:'.hash('sha256', $user."\0".$ipNorm);
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

    private function protocolUserKey(string $user): string
    {
        return 'dav-login-user:'.$user;
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
