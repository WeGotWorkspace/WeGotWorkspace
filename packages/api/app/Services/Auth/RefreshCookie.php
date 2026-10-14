<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Services\Installer\InstallerWebBase;
use App\Support\HttpsDetection;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * HttpOnly carrier for the SPA refresh token (#1175).
 *
 * JavaScript never holds the refresh token. The cookie is scoped to the auth
 * endpoints only, so it is not sent to any other API route.
 */
final class RefreshCookie
{
    public const NAME = 'wgw_refresh';

    public function __construct(private RefreshTokenRepository $refreshTokens) {}

    public function issue(string $token): Cookie
    {
        return $this->build($token, time() + $this->refreshTokens->refreshTtl());
    }

    public function forget(): Cookie
    {
        return $this->build('', 1);
    }

    public function read(Request $request): ?string
    {
        $value = $request->cookie(self::NAME);
        if (! is_string($value)) {
            return null;
        }
        $value = trim($value);

        return $value === '' ? null : $value;
    }

    public function path(): string
    {
        $path = rtrim(InstallerWebBase::url(InstallerWebBase::detect(), '/api/v1/auth'), '/');

        return $path === '' ? '/api/v1/auth' : $path;
    }

    private function build(string $value, int $expiresAt): Cookie
    {
        return Cookie::create(
            self::NAME,
            $value,
            $expiresAt,
            $this->path(),
            null,
            HttpsDetection::isSecure(),
            true,
            false,
            Cookie::SAMESITE_STRICT,
        );
    }
}
