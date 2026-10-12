<?php

declare(strict_types=1);

namespace App\Dav\Auth;

use App\Services\Auth\LoginRateLimiter;
use App\Services\Auth\UserEnabledGuard;
use Sabre\DAV\Auth\Backend\PDOBasicAuth;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

final class SabrePdoBasicAndCookieAuth extends PDOBasicAuth
{
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

        if (! parent::validateUserPass($username, $password) || ! app(UserEnabledGuard::class)->isEnabled($user)) {
            $limiter->hitProtocol($user, $clientIp);

            return false;
        }

        return true;
    }
}
