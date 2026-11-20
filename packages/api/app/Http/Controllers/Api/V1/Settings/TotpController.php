<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Settings;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Models\User;
use App\Services\Auth\CurrentPasswordCheck;
use App\Services\Auth\LoginRateLimiter;
use App\Services\Auth\Mfa\CurrentCodeCheck;
use App\Services\Auth\Mfa\MfaCodeCheck;
use App\Services\Auth\Mfa\TotpService;
use App\Services\Auth\Mfa\UserMfaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * The caller's authenticator (#2273): start and confirm a setup, turn it off,
 * new recovery codes. Every code goes through the sign-in limits and the
 * per-user code lock; a wrong code is 403 here, because the session is valid.
 */
final class TotpController
{
    public function __construct(
        private UserMfaService $mfa,
        private TotpService $totp,
        private MfaCodeCheck $codes,
        private CurrentPasswordCheck $currentPassword,
        private LoginRateLimiter $limiter,
        private CurrentCodeCheck $currentCode,
    ) {}

    public function start(Request $request): JsonResponse
    {
        $username = $this->username($request);
        $currentPassword = $this->required($request, 'currentPassword', 4096);
        if ($this->mfa->isEnabled($username)) {
            throw UserMfaService::alreadyEnabled();
        }
        $this->currentPassword->assert($username, $currentPassword, $this->ip($request));

        $secret = $this->totp->generateSecret();
        $this->mfa->startSetup($username, $secret);
        $usedAt = User::query()->where('username', $username)->value('dav_password_used_at');

        return response()->json([
            'secret' => $secret,
            'otpauth_uri' => $this->totp->provisioningUri($request->getHost(), $username, $secret),
            'davPasswordUsedAt' => $usedAt === null ? null : Carbon::parse($usedAt)->toIso8601String(),
        ]);
    }

    public function confirm(Request $request): JsonResponse
    {
        $username = $this->username($request);
        $currentPassword = $this->required($request, 'currentPassword', 4096);
        $code = $this->required($request, 'code', 32);
        if ($this->mfa->isEnabled($username)) {
            throw UserMfaService::alreadyEnabled();
        }
        $this->currentPassword->assert($username, $currentPassword, $this->ip($request));

        $secret = $this->mfa->pendingSecret($username);
        if ($secret === null) {
            throw new ApiHttpException(400, 'Start the setup first.', 'mfa_setup_missing');
        }
        $this->assertSignInLimit($username, $request);
        $step = $this->codes->matchNewSecret($username, $secret, $code);
        if ($step === null) {
            $this->wrongCode($username, $request);
        }

        return response()->json(['recovery_codes' => $this->mfa->enable($username, $step)]);
    }

    public function disable(Request $request): JsonResponse
    {
        $username = $this->username($request);
        $this->assertCurrentCode($username, $request);
        $this->mfa->disable($username);

        return response()->json(['ok' => true]);
    }

    public function recoveryCodes(Request $request): JsonResponse
    {
        $username = $this->username($request);
        $this->assertCurrentCode($username, $request);

        return response()->json(['recovery_codes' => $this->mfa->newRecoveryCodes($username)]);
    }

    private function assertCurrentCode(string $username, Request $request): void
    {
        $code = $this->required($request, 'code', 32);
        if (! $this->mfa->isEnabled($username)) {
            throw UserMfaService::notEnabled();
        }
        $this->currentCode->assert($username, $code, $this->ip($request));
    }

    private function assertSignInLimit(string $username, Request $request): void
    {
        $ip = $this->ip($request);
        if (! $this->limiter->allow($username, $ip)) {
            throw LoginRateLimiter::throttled($this->limiter->retryAfter($username, $ip));
        }
    }

    private function wrongCode(string $username, Request $request): never
    {
        $this->limiter->hit($username, $this->ip($request));

        throw CurrentCodeCheck::wrongCode();
    }

    private function required(Request $request, string $key, int $max): string
    {
        $value = $request->input($key);
        if (! is_string($value) || trim($value) === '' || strlen($value) > $max) {
            throw new ApiHttpException(400, "The {$key} field is required.", 'bad_request');
        }

        return $value;
    }

    private function ip(Request $request): string
    {
        return (string) ($request->ip() ?? '');
    }

    private function username(Request $request): string
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return $principal['username'];
    }
}
