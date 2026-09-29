<?php

declare(strict_types=1);

namespace App\Dav\Auth;

use App\Services\Auth\SabreCredentialValidator;
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
        $client = $_SERVER['HTTP_USER_AGENT'] ?? null;

        return app(SabreCredentialValidator::class)->validateProtocol(
            (string) $username,
            (string) $password,
            (string) $this->realm,
            is_string($client) ? $client : null,
        );
    }
}
