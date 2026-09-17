<?php

declare(strict_types=1);

namespace App\Dav\Auth;

use App\Services\Auth\UserEnabledGuard;
use Sabre\DAV\Auth\Backend\PDOBasicAuth;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

final class SabrePdoBasicAndCookieAuth extends PDOBasicAuth
{
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
        if (! parent::validateUserPass($username, $password)) {
            return false;
        }

        return app(UserEnabledGuard::class)->isEnabled((string) $username);
    }
}
