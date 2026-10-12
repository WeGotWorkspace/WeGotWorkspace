<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Requests\Api\V1\AuthRevokeRequest;
use App\Services\Auth\AuthTokenService;
use App\Services\Auth\BearerAuthenticationService;
use App\Services\Auth\UiSessionService;
use App\Services\Auth\UserSessionRevoker;
use App\Services\Installer\InstallerWebBase;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cookie;

final class RevokeController
{
    public function __construct(
        private AuthTokenService $authTokens,
        private BearerAuthenticationService $bearerAuth,
        private UserSessionRevoker $sessions,
        private UiSessionService $uiSession,
    ) {}

    public function __invoke(AuthRevokeRequest $request): JsonResponse
    {
        $principal = $this->bearerAuth->authenticate($request->header('Authorization'));
        $refreshToken = $request->validated()['refresh_token'] ?? null;
        $bearer = $this->bearerAuth->extractBearerToken($request->header('Authorization'));

        $this->authTokens->revoke($principal, $bearer, is_string($refreshToken) ? $refreshToken : null);
        if ($principal !== null && $principal['role'] !== 'guest') {
            $this->sessions->bumpEpoch($principal['username']);
        }

        return response()->json(['ok' => true])->withCookie(
            Cookie::forget('sabre_ui_auth', $this->uiSession->issuedCookiePath(InstallerWebBase::detect())),
        );
    }
}
