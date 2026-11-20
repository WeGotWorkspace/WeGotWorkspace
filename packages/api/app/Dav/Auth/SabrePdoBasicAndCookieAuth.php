<?php

declare(strict_types=1);

namespace App\Dav\Auth;

use App\Models\User;
use App\Services\Auth\LoginRateLimiter;
use App\Services\Auth\ProtocolCredentials;
use Sabre\DAV\Auth\Backend\PDOBasicAuth;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

final class SabrePdoBasicAndCookieAuth extends PDOBasicAuth
{
    private const VERIFIED_SECONDS = 300;

    /** @return array<mixed> */
    public function check(RequestInterface $request, ResponseInterface $response)
    {
        $fromGate = SabreUiAuthGate::validatedUsername($this->realm);
        if ($fromGate !== null) {
            return [true, $this->principalPrefix.$fromGate];
        }

        return parent::check($request, $response);
    }

    public function validateUserPass($username, $password)
    {
        $limiter = app(LoginRateLimiter::class);
        $ip = request()->ip();
        $clientIp = is_string($ip) ? $ip : '';
        $user = (string) $username;
        if (! $limiter->allowProtocol($user, $clientIp)) {
            throw new TooManyAttempts($limiter->protocolRetryAfter($user, $clientIp));
        }

        $password = (string) $password;
        $userAgent = request()->userAgent();
        $valid = app(ProtocolCredentials::class)->verify(
            $user,
            $password,
            is_string($userAgent) ? $userAgent : null,
            fn (): bool => $this->passwordMatches($user, $password),
        );
        if (! $valid) {
            $limiter->hitProtocol($user, $clientIp);

            return false;
        }

        return true;
    }

    private function passwordMatches(string $username, string $password): bool
    {
        $row = User::query()->where('username', $username)->first(['id', 'digest']);
        if ($row === null) {
            return false;
        }

        $digest = (string) $row->digest;
        $secret = (string) config('app.key');
        $memory = app(VerifiedPasswordMemory::class)->store();
        if ($memory === null) {
            return password_verify($password, $digest);
        }

        // A keyed MAC, so the cache never holds anything that recovers or replays the
        // password; the digest in it makes a password change or rehash miss at once.
        // The key is keyed too, so installs sharing one APCu segment keep separate entries.
        $key = 'dav-basic-verified:'.substr(hash_hmac('sha256', (string) $row->id, $secret), 0, 32);
        $mac = hash_hmac('sha256', $row->id.'|'.$digest.'|'.$password, $secret);
        $remembered = $memory->get($key);
        if (is_string($remembered) && hash_equals($remembered, $mac)) {
            return true;
        }
        if (! password_verify($password, $digest)) {
            return false;
        }
        $memory->put($key, $mac, self::VERIFIED_SECONDS);

        return true;
    }
}
