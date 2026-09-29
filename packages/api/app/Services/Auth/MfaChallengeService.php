<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\AppSetting;
use App\Models\AuthChallenge;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Carbon;

final class MfaChallengeService
{
    private const int MAX_ATTEMPTS = 5;

    public function __construct(
        private AuthChallengeService $challenges,
        private MfaCodeFailCounter $codeFails,
        private LoginRateLimiter $ipLimiter,
        private LoginAttemptGuard $attempts,
        private TotpService $totp,
        private RecoveryCodeService $recoveryCodes,
        private UserMfaService $mfa,
        private MfaSessionReissue $sessionReissue,
        private AuthTokenService $tokens,
        private DavClientWarning $davWarning,
        private MfaReauth $reauth,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function verify(
        string $challengeId,
        ?string $code,
        ?string $recoveryCode,
        string $ip,
        string $expectedClient = 'spa',
    ): array {
        $this->assertNotLocked($challengeId);
        $challenge = $this->challenges->findOpen($challengeId);
        $this->assertClient($challenge, $expectedClient);
        $this->assertAttemptAllowed($challenge, $ip);
        $code = $this->blankToNull($code);
        $recoveryCode = $this->blankToNull($recoveryCode);
        if (($code === null) === ($recoveryCode === null)) {
            throw new ApiHttpException(400, 'Send an authenticator code or a recovery code.', 'bad_request');
        }

        if ($recoveryCode !== null) {
            if ($challenge->kind !== 'totp') {
                $this->rejectCode($challenge, $ip);
            }

            return $this->acceptRecovery($challenge, $challengeId, $recoveryCode, $ip);
        }
        if ($challenge->kind !== 'totp') {
            throw new ApiHttpException(400, 'Submit the new authenticator code to confirmation.', 'bad_request');
        }

        $result = $this->totp->consumeLive($challenge->username, (string) $code);
        if ($result === 'reused') {
            throw new ApiHttpException(401, TotpService::REUSED_MESSAGE, 'totp_step_reused');
        }
        if ($result !== 'ok') {
            $this->rejectCode($challenge, $ip);
        }

        $username = $challenge->username;
        $challenge->delete();
        $this->attempts->succeed($username, $ip);

        return ['status' => 'ok'] + $this->tokens->issueForUsername($username);
    }

    /**
     * @return array{secret: string, otpauth_uri: string, dav_warning: bool}
     */
    public function provision(string $challengeId, string $requestHost, ?string $password = null): array
    {
        $challenge = $this->challenges->findOpen($challengeId);
        if (! in_array($challenge->kind, ['totp_setup', 'totp_replace'], true)) {
            throw new ApiHttpException(409, 'This challenge is waiting for a code.', 'conflict');
        }
        if ($challenge->kind === 'totp_setup') {
            $this->reauth->assert($challenge->username, $password, null);
        }

        $secret = $challenge->pending_secret;
        if (! is_string($secret) || $secret === '') {
            $secret = $this->totp->generateSecret();
            $challenge->pending_secret = $secret;
            $challenge->save();
        }

        return [
            'secret' => $secret,
            'otpauth_uri' => $this->totp->provisioningUri(
                $this->issuer($requestHost),
                $challenge->username,
                $secret,
            ),
            'dav_warning' => $this->davWarning->applies($challenge->username),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function confirm(
        string $challengeId,
        string $code,
        string $ip,
        string $expectedClient = 'spa',
        ?string $password = null,
    ): array {
        $this->assertNotLocked($challengeId);
        $challenge = $this->challenges->findOpen($challengeId);
        $this->assertClient($challenge, $expectedClient);
        $this->assertAttemptAllowed($challenge, $ip);
        if (! in_array($challenge->kind, ['totp_setup', 'totp_replace'], true)) {
            throw new ApiHttpException(400, 'Confirm this challenge with verification.', 'bad_request');
        }
        $replace = $challenge->kind === 'totp_replace';
        if (! $replace && $this->mfa->isEnabled($challenge->username)) {
            $challenge->delete();
            throw new ApiHttpException(409, 'Two-factor authentication is already on.', 'conflict');
        }
        if (! $replace) {
            $this->reauth->assert($challenge->username, $password, null);
        }
        $secret = $challenge->pending_secret;
        if (! is_string($secret) || $secret === '') {
            throw new ApiHttpException(400, 'Set up an authenticator first.', 'bad_request');
        }

        $step = $this->totp->matchingStep($secret, $code);
        if ($step === null) {
            $this->rejectCode($challenge, $ip);
        }

        $claimed = AuthChallenge::query()
            ->where('id', $challenge->id)
            ->whereNull('consumed_at')
            ->update(['consumed_at' => Carbon::now()]);
        if ($claimed !== 1) {
            throw new ApiHttpException(401, 'Invalid or expired challenge.', 'unauthorized');
        }

        $username = $challenge->username;
        $this->mfa->enable($username, $secret, $step, $replace);
        $codes = $this->recoveryCodes->replaceAll($username);
        $this->sessionReissue->afterAuthenticatorChanged($username);
        $this->attempts->succeed($username, $ip);

        return ['status' => 'ok', 'recovery_codes' => $codes] + $this->tokens->issueForUsername($username);
    }

    private function assertNotLocked(string $challengeId): void
    {
        $username = $this->challenges->owner($challengeId);
        if ($username !== null && $this->codeFails->isLocked($username)) {
            throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function acceptRecovery(AuthChallenge $challenge, string $challengeId, string $recoveryCode, string $ip): array
    {
        if (! $this->recoveryCodes->consume($challenge->username, $recoveryCode)) {
            $this->rejectCode($challenge, $ip);
        }

        $challenge->kind = 'totp_replace';
        $challenge->expires_at = Carbon::now()->addMinutes(15);
        $challenge->attempts = 0;
        $challenge->pending_secret = null;
        $challenge->save();

        return [
            'status' => 'mfa_replace_required',
            'challenge' => strtolower(trim($challengeId)),
            'client' => $challenge->client === 'oauth' ? 'oauth' : 'spa',
        ];
    }

    private function assertClient(AuthChallenge $challenge, string $expectedClient): void
    {
        $expected = $expectedClient === 'oauth' ? 'oauth' : 'spa';
        $actual = $challenge->client === 'oauth' ? 'oauth' : 'spa';
        if ($actual !== $expected) {
            throw new ApiHttpException(
                409,
                $expected === 'oauth'
                    ? 'This challenge belongs to the app sign-in.'
                    : 'Complete this sign-in on the assistant login.',
                'conflict',
            );
        }
    }

    private function assertAttemptAllowed(AuthChallenge $challenge, string $ip): void
    {
        $capped = (int) $challenge->attempts >= self::MAX_ATTEMPTS;
        if (! $capped && ! $this->ipLimiter->tooManyAttempts($challenge->username, $ip)) {
            return;
        }
        if ($capped) {
            $challenge->delete();
        }

        throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
    }

    private function rejectCode(AuthChallenge $challenge, string $ip): never
    {
        $challenge->increment('attempts');
        $locked = $this->codeFails->recordFailure($challenge->username);
        $ipBlocked = ! $this->ipLimiter->allow($challenge->username, $ip);
        if ($locked || $ipBlocked || (int) $challenge->attempts >= self::MAX_ATTEMPTS + 1) {
            throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
        }

        throw new ApiHttpException(401, 'Invalid code.', 'unauthorized');
    }

    private function issuer(string $requestHost): string
    {
        $base = AppSetting::getValue(SettingKeys::BASE_URI);

        return $this->totp->issuer(is_string($base) ? $base : null, $requestHost);
    }

    private function blankToNull(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }
}
