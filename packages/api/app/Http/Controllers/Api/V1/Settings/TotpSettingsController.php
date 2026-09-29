<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Settings;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Models\AppSetting;
use App\Services\Auth\MfaReauth;
use App\Services\Auth\MfaSessionReissue;
use App\Services\Auth\RecoveryCodeService;
use App\Services\Auth\TotpService;
use App\Services\Auth\UserMfaService;
use App\Services\Settings\SettingKeys;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class TotpSettingsController
{
    public function __construct(
        private UserMfaService $mfa,
        private TotpService $totp,
        private RecoveryCodeService $recoveryCodes,
        private MfaReauth $reauth,
        private MfaSessionReissue $sessionReissue,
    ) {}

    public function store(Request $request): JsonResponse
    {
        $username = $this->username($request);
        if ($this->mfa->isEnabled($username)) {
            throw new ApiHttpException(409, 'Two-factor authentication is already on.', 'conflict');
        }

        $secret = $this->mfa->pendingSecret($username);
        if ($secret === null) {
            $secret = $this->totp->generateSecret();
            $this->mfa->storePending($username, $secret);
        }

        return response()->json([
            'secret' => $secret,
            'otpauth_uri' => $this->totp->provisioningUri($this->issuer($request), $username, $secret),
        ]);
    }

    public function confirm(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => ['required', 'string', 'max:16'],
        ]);
        $username = $this->username($request);
        $secret = $this->mfa->pendingSecret($username);
        if ($secret === null) {
            throw new ApiHttpException(400, 'Set up an authenticator first.', 'bad_request');
        }

        $step = $this->totp->matchingStep($secret, (string) $validated['code']);
        if ($step === null) {
            throw new ApiHttpException(401, 'Invalid code.', 'unauthorized');
        }

        $this->mfa->enable($username, $secret, $step);
        $codes = $this->recoveryCodes->replaceAll($username);
        $this->sessionReissue->afterAuthenticatorChanged($username);

        return response()->json([
            'recovery_codes' => $codes,
        ]);
    }

    public function destroy(Request $request): JsonResponse
    {
        $username = $this->username($request);
        $this->reauth->assert(
            $username,
            $request->input('password') !== null ? (string) $request->input('password') : null,
            $request->input('code') !== null ? (string) $request->input('code') : null,
        );
        if (! $this->mfa->isEnabled($username)) {
            throw new ApiHttpException(404, 'Two-factor authentication is not on.', 'not_found');
        }

        $this->mfa->disable($username);
        $this->recoveryCodes->deleteAll($username);

        return response()->json(['ok' => true]);
    }

    public function regenerate(Request $request): JsonResponse
    {
        $username = $this->username($request);
        if (! $this->mfa->isEnabled($username)) {
            throw new ApiHttpException(409, 'Two-factor authentication is not on.', 'conflict');
        }

        $this->reauth->assert(
            $username,
            null,
            $request->input('code') !== null ? (string) $request->input('code') : null,
        );

        return response()->json([
            'recovery_codes' => $this->recoveryCodes->replaceAll($username),
        ]);
    }

    private function username(Request $request): string
    {
        /** @var array{username: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (string) $principal['username'];
    }

    private function issuer(Request $request): string
    {
        $base = AppSetting::getValue(SettingKeys::BASE_URI);

        return $this->totp->issuer(is_string($base) ? $base : null, $request->getHost());
    }
}
