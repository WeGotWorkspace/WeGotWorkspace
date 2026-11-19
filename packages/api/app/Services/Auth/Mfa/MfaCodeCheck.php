<?php

declare(strict_types=1);

namespace App\Services\Auth\Mfa;

/**
 * Checks a code of a user with two-factor on: their authenticator code or one
 * of their recovery codes. Every failure counts on the per-user limiter, and a
 * locked user is refused before the code is read.
 */
final class MfaCodeCheck
{
    public function __construct(
        private UserMfaService $mfa,
        private TotpService $totp,
        private RecoveryCodeService $recoveryCodes,
        private MfaCodeLimiter $limiter,
    ) {}

    /**
     * True when the code is right and newer than the last accepted one; it is
     * recorded so it cannot be used again.
     */
    public function acceptTotp(string $username, string $code): bool
    {
        $this->limiter->assertNotLocked($username);
        $row = $this->mfa->enabledRow($username);
        if ($row === null) {
            return false;
        }

        $step = $this->totp->matchingStep($this->mfa->readSecret($row), $code, $row->last_used_step);
        if ($step !== null && $this->mfa->recordStep($row, $step)) {
            return true;
        }
        $this->limiter->recordFailure($username);

        return false;
    }

    /**
     * True when the recovery code was unused; it is spent.
     */
    public function acceptRecoveryCode(string $username, string $code): bool
    {
        $this->limiter->assertNotLocked($username);
        if ($this->recoveryCodes->consume($username, $code)) {
            return true;
        }
        $this->limiter->recordFailure($username);

        return false;
    }

    /**
     * The step of a code from a new secret (setup or replacement), or null. A
     * failure counts on the per-user limiter.
     */
    public function matchNewSecret(string $username, string $secret, string $code): ?int
    {
        $this->limiter->assertNotLocked($username);
        $step = $this->totp->matchingStep($secret, $code, null);
        if ($step === null) {
            $this->limiter->recordFailure($username);
        }

        return $step;
    }
}
