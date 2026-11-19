<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;
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
 */
final class ProtocolCredentials
{
    public const int ACCOUNT_PASSWORD_TOUCH_SECONDS = 300;

    public function __construct(
        private AppPasswordService $appPasswords,
        private UserEnabledGuard $enabled,
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

        if (! $accountPasswordMatches() || ! $this->enabled->isEnabled($username)) {
            return false;
        }

        $this->touchAccountPasswordUse($username);

        return true;
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
