<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Services\Auth\AuthTokenService;
use App\Services\Auth\BearerAuthenticationService;
use App\Services\Auth\RefreshCookie;
use App\Services\Auth\UiSessionService;
use App\Services\Auth\UserSessionRevoker;
use App\Services\Installer\InstallerWebBase;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;

final class RevokeController
{
    public function __construct(
        private AuthTokenService $authTokens,
        private BearerAuthenticationService $bearerAuth,
        private UserSessionRevoker $sessions,
        private UiSessionService $uiSession,
        private RefreshCookie $refreshCookie,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $principal = $this->bearerAuth->authenticate($request->header('Authorization'));
        $refreshToken = $this->refreshCookie->read($request);
        $bearer = $this->bearerAuth->extractBearerToken($request->header('Authorization'));

        $this->authTokens->revoke($principal, $bearer, $refreshToken);
        if ($principal !== null && $principal['role'] !== 'guest') {
            $this->sessions->bumpEpoch($principal['username']);
        }

        return response()->json(['ok' => true])
            ->withCookie(Cookie::forget('sabre_ui_auth', $this->uiSession->issuedCookiePath(InstallerWebBase::detect())))
            ->withCookie($this->refreshCookie->forget());
    }
}
