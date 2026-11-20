<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;
use App\Services\Auth\Mfa\UserMfaService;
use Closure;
use Illuminate\Support\Carbon;

/**
 * The password check shared by DAV Basic and Meet Basic (#2271): an app
 * password first, then the account password. Each caller keeps its own
 * account-password check (DAV with the APCu verified-password memory), passed
 * in as a closure, and its own rate limiting.
 *
 * An app password never reaches the account-password check and is never
 * remembered. A sign-in with the account password is recorded in
 * `users.dav_password_used_at`, at most once per five minutes, so the user can
 * see which clients still need an app password.
 *
 * With two-factor on (#2273) the account password is refused before the
 * caller's check runs, so a password remembered in APCu from before cannot
 * sign in either. Only app passwords work then.
 */
final class ProtocolCredentials
{
    public const int ACCOUNT_PASSWORD_TOUCH_SECONDS = 300;

    public function __construct(
        private AppPasswordService $appPasswords,
        private UserEnabledGuard $enabled,
        private UserMfaService $mfa,
    ) {}

    /**
     * @param  Closure(): bool  $accountPasswordMatches
     */
    public function verify(string $username, string $password, ?string $client, Closure $accountPasswordMatches): bool
    {
        $username = strtolower(trim($username));
        if ($username === '' || $password === '') {
            return false;
        }

        if ($this->appPasswords->matches($username, $password, $client)) {
            return $this->enabled->isEnabled($username);
        }

        if ($this->mfa->isEnabled($username)) {
            return false;
        }
        if (! $accountPasswordMatches() || ! $this->enabled->isEnabled($username)) {
            return false;
        }

        $this->touchAccountPasswordUse($username);

        return true;
    }

    /**
     * The app-password half of verify(), for a caller whose protocol sign-in
     * limit is reached: a valid app password still signs in, the account
     * password is not checked at all (#2273). App passwords are ~75 random
     * bits behind one indexed sha256 lookup, so this gives no guessing gain,
     * and an old client still sending the account password after two-factor
     * was turned on cannot lock out the user's new app passwords.
     */
    public function verifyAppPasswordOnly(string $username, string $password, ?string $client): bool
    {
        $username = strtolower(trim($username));
        if ($username === '' || $password === '') {
            return false;
        }

        return $this->appPasswords->matches($username, $password, $client)
            && $this->enabled->isEnabled($username);
    }

    private function touchAccountPasswordUse(string $username): void
    {
        $now = Carbon::now();
        User::query()
            ->where('username', $username)
            ->where(static function ($query) use ($now): void {
                $query->whereNull('dav_password_used_at')
                    ->orWhere('dav_password_used_at', '<=', $now->copy()->subSeconds(self::ACCOUNT_PASSWORD_TOUCH_SECONDS));
            })
            ->update(['dav_password_used_at' => $now]);
    }
}
