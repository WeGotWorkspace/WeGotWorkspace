<?php

declare(strict_types=1);

namespace App\Services\Auth\Mfa;

use App\Exceptions\ApiHttpException;
use App\Models\AuthChallenge;
use App\Models\UserMfa;
use App\Services\Auth\UserSessionRevoker;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Whether a user has two-factor on, and every write to their authenticator.
 * The stored secret is read only here, through the model's `encrypted` cast.
 */
final class UserMfaService
{
    public function __construct(
        private RecoveryCodeService $recoveryCodes,
        private AuthChallengeService $challenges,
        private UserSessionRevoker $sessions,
    ) {}

    public function isEnabled(string $username): bool
    {
        return UserMfa::query()
            ->where('username', $this->user($username))
            ->whereNotNull('enabled_at')
            ->exists();
    }

    /**
     * @return array{enabled: bool, recoveryCodesRemaining: int}
     */
    public function status(string $username): array
    {
        $enabled = $this->isEnabled($username);

        return [
            'enabled' => $enabled,
            'recoveryCodesRemaining' => $enabled ? $this->recoveryCodes->remaining($username) : 0,
        ];
    }

    /**
     * Stores a new setup secret, replacing an unconfirmed one. Refused while
     * two-factor is on: the live row is left as it is.
     */
    public function startSetup(string $username, string $secret): void
    {
        $username = $this->user($username);
        DB::connection('wgw')->transaction(function () use ($username, $secret): void {
            $row = UserMfa::query()->where('username', $username)->lockForUpdate()->first();
            if ($row?->enabled_at !== null) {
                throw self::alreadyEnabled();
            }
            $row ??= new UserMfa(['username' => $username]);
            $row->totp_secret = $secret;
            $row->last_used_step = null;
            $row->save();
        });
    }

    /**
     * The secret of a setup in progress, or null when there is none.
     */
    public function pendingSecret(string $username): ?string
    {
        $row = UserMfa::query()->where('username', $this->user($username))->whereNull('enabled_at')->first();

        return $row === null ? null : $this->readSecret($row);
    }

    /**
     * The row of a user with two-factor on, or null.
     */
    public function enabledRow(string $username): ?UserMfa
    {
        return UserMfa::query()->where('username', $this->user($username))->whereNotNull('enabled_at')->first();
    }

    /**
     * Turns two-factor on with the setup secret, stores new recovery codes and
     * ends every session of the user.
     *
     * @return list<string>
     */
    public function enable(string $username, int $step): array
    {
        $username = $this->user($username);

        return DB::connection('wgw')->transaction(function () use ($username, $step): array {
            $updated = UserMfa::query()
                ->where('username', $username)
                ->whereNull('enabled_at')
                ->update(['enabled_at' => Carbon::now(), 'last_used_step' => $step, 'updated_at' => Carbon::now()]);
            if ($updated !== 1) {
                throw self::alreadyEnabled();
            }
            $codes = $this->recoveryCodes->replaceAll($username);
            $this->challenges->forgetUser($username);
            $this->sessions->revokeAll($username);

            return $codes;
        });
    }

    /**
     * Replaces the authenticator after a recovery code: the new secret, new
     * recovery codes, every session ended, all in one transaction.
     *
     * @return list<string>
     */
    public function replace(string $username, string $secret, int $step): array
    {
        $username = $this->user($username);

        return DB::connection('wgw')->transaction(function () use ($username, $secret, $step): array {
            $row = UserMfa::query()->where('username', $username)->whereNotNull('enabled_at')->lockForUpdate()->first();
            if ($row === null) {
                throw AuthChallengeService::notFound();
            }
            $row->totp_secret = $secret;
            $row->last_used_step = $step;
            $row->save();
            $codes = $this->recoveryCodes->replaceAll($username);
            $this->challenges->forgetUser($username);
            $this->sessions->revokeAll($username);

            return $codes;
        });
    }

    /**
     * Records the step of an accepted code, so the same or an older code is
     * refused. False when another request recorded it first.
     */
    public function recordStep(UserMfa $row, int $step): bool
    {
        return UserMfa::query()
            ->whereKey($row->id)
            ->where(static function ($query) use ($step): void {
                $query->whereNull('last_used_step')->orWhere('last_used_step', '<', $step);
            })
            ->update(['last_used_step' => $step]) === 1;
    }

    /**
     * A new set of recovery codes; the previous set stops working.
     *
     * @return list<string>
     */
    public function newRecoveryCodes(string $username): array
    {
        return $this->recoveryCodes->replaceAll($this->user($username));
    }

    /**
     * Turns two-factor off. Revokes no session.
     */
    public function disable(string $username): void
    {
        $this->forget($username);
    }

    /**
     * Deletes the authenticator, recovery codes and open challenges without
     * reading the secret, so it works when the secret cannot be decrypted.
     */
    public function forget(string $username): void
    {
        $username = $this->user($username);
        UserMfa::query()->where('username', $username)->delete();
        $this->recoveryCodes->deleteAll($username);
        $this->challenges->forgetUser($username);
    }

    /**
     * The admin and CLI reset: deletes the authenticator, recovery codes and
     * open challenges, then ends every session. Never reads the secret. After
     * it the user signs in with the password alone.
     */
    public function reset(string $username): void
    {
        $this->forget($username);
        $this->sessions->revokeAll($this->user($username));
    }

    /**
     * Fails closed when `APP_KEY` changed: a clear log line and 503.
     */
    public function readSecret(UserMfa $row): string
    {
        try {
            return (string) $row->getAttribute('totp_secret');
        } catch (DecryptException) {
            Log::error('mfa_secret_unreadable', ['username' => $row->username, 'hint' => 'APP_KEY changed? Reset this user\'s two-factor (wgw:mfa:reset).']);

            throw new ApiHttpException(503, 'Two-factor sign-in is not available for this account. Ask an admin to reset it.', 'mfa_unavailable');
        }
    }

    /**
     * The new secret of a replacement challenge, failing closed the same way.
     */
    public function readPendingSecret(AuthChallenge $challenge): string
    {
        try {
            return (string) $challenge->getAttribute('pending_secret');
        } catch (DecryptException) {
            Log::error('mfa_secret_unreadable', ['username' => $challenge->username, 'hint' => 'APP_KEY changed during a replacement. Sign in again.']);

            throw new ApiHttpException(503, 'Two-factor sign-in is not available right now. Sign in again.', 'mfa_unavailable');
        }
    }

    public static function alreadyEnabled(): ApiHttpException
    {
        return new ApiHttpException(409, 'Two-factor authentication is already on.', 'mfa_already_enabled');
    }

    public static function notEnabled(): ApiHttpException
    {
        return new ApiHttpException(409, 'Two-factor authentication is not on.', 'mfa_not_enabled');
    }

    private function user(string $username): string
    {
        return strtolower(trim($username));
    }
}
