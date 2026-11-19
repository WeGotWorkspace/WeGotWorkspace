<?php

declare(strict_types=1);

namespace App\Services\Auth\Mfa;

use App\Exceptions\ApiHttpException;
use App\Models\AuthChallenge;
use App\Services\Auth\LoginRateLimiter;
use App\Services\Auth\UserEnabledGuard;

/**
 * The step after a correct password for a user with two-factor on (#2273),
 * shared by `auth/mfa-challenges/…` (client `spa`) and `oauth/session`
 * (client `oauth`). It answers who signed in; the caller issues tokens or
 * starts the web session.
 *
 * Order on every code: the address limit, the challenge lookup (an unknown id
 * counts on the address only), the user-and-address limit, the enabled check,
 * the per-user code lock, then the code.
 */
final class MfaSignIn
{
    public function __construct(
        private UserMfaService $mfa,
        private AuthChallengeService $challenges,
        private MfaCodeCheck $codes,
        private TotpService $totp,
        private LoginRateLimiter $limiter,
        private UserEnabledGuard $enabled,
    ) {}

    /**
     * The `mfa_required` answer for a user with two-factor on, or null.
     *
     * @return array{status: 'mfa_required', challenge: string, client: string}|null
     */
    public function challengeAfterPassword(string $username, string $client): ?array
    {
        if (! $this->mfa->isEnabled($username)) {
            return null;
        }

        return [
            'status' => 'mfa_required',
            'challenge' => $this->challenges->issue($username, AuthChallenge::KIND_LOGIN, $client),
            'client' => $client,
        ];
    }

    /**
     * A code or a recovery code on a `login` challenge.
     *
     * @return array{status: 'ok', username: string}|array{status: 'mfa_replace_required', challenge: string, client: string, secret: string, otpauth_uri: string}
     */
    public function verify(string $id, string $client, ?string $code, ?string $recoveryCode, string $ip, string $host): array
    {
        $code = $this->blankToNull($code);
        $recoveryCode = $this->blankToNull($recoveryCode);
        if (($code === null) === ($recoveryCode === null)) {
            throw new ApiHttpException(400, 'Send an authenticator code or a recovery code.', 'bad_request');
        }

        $challenge = $this->open($id, $client, AuthChallenge::KIND_LOGIN, $ip);
        $username = $challenge->username;

        if ($code !== null) {
            if (! $this->codes->acceptTotp($username, $code)) {
                $this->refuse($challenge, $ip);
            }
            $this->challenges->consume($challenge);
            $this->limiter->reset($username, $ip);

            return ['status' => 'ok', 'username' => $username];
        }

        if (! $this->codes->acceptRecoveryCode($username, (string) $recoveryCode)) {
            $this->refuse($challenge, $ip);
        }
        $this->challenges->consume($challenge);
        $secret = $this->totp->generateSecret();

        return [
            'status' => 'mfa_replace_required',
            'challenge' => $this->challenges->issue($username, AuthChallenge::KIND_REPLACE, $client, $secret),
            'client' => $client,
            'secret' => $secret,
            'otpauth_uri' => $this->totp->provisioningUri($host, $username, $secret),
        ];
    }

    /**
     * A code from the new secret on a `replace` challenge. Stores it, replaces
     * the recovery codes and ends every session before the caller signs in.
     *
     * @return array{username: string, recovery_codes: list<string>}
     */
    public function replace(string $id, string $client, string $code, string $ip): array
    {
        $challenge = $this->open($id, $client, AuthChallenge::KIND_REPLACE, $ip);
        $username = $challenge->username;
        $secret = (string) $challenge->pending_secret;

        $step = $this->codes->matchNewSecret($username, $secret, $code);
        if ($step === null) {
            $this->refuse($challenge, $ip);
        }
        $this->challenges->consume($challenge);
        $recoveryCodes = $this->mfa->replace($username, $secret, $step);
        $this->limiter->reset($username, $ip);

        return ['username' => $username, 'recovery_codes' => $recoveryCodes];
    }

    /**
     * The kind of an open challenge of this client, for `oauth/session`, which
     * takes both steps on one route.
     */
    public function kindOf(string $id, string $client): ?string
    {
        return $this->challenges->findOpen($id, $client)?->kind;
    }

    private function open(string $id, string $client, string $kind, string $ip): AuthChallenge
    {
        if (! $this->limiter->allowIp($ip)) {
            throw LoginRateLimiter::throttled($this->limiter->ipRetryAfter($ip));
        }

        $challenge = $this->challenges->findOpen($id, $client);
        if ($challenge === null || $challenge->kind !== $kind) {
            $this->limiter->hitIp($ip);

            throw AuthChallengeService::notFound();
        }

        $username = $challenge->username;
        if (! $this->limiter->allow($username, $ip)) {
            throw LoginRateLimiter::throttled($this->limiter->retryAfter($username, $ip));
        }
        if (! $this->enabled->isEnabled($username)) {
            $this->challenges->consume($challenge);

            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }

        return $challenge;
    }

    private function refuse(AuthChallenge $challenge, string $ip): never
    {
        $this->challenges->recordFailure($challenge);
        $this->limiter->hit($challenge->username, $ip);

        throw new ApiHttpException(401, 'That code is not right. Check the time on your phone and try again.', 'mfa_code_invalid');
    }

    private function blankToNull(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
