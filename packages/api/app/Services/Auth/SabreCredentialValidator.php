<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Sabre\DAV\Auth\Backend\PDOBasicAuth;

final class SabreCredentialValidator
{
    private const TOUCH_INTERVAL_SECONDS = 300;

    public function __construct(
        private UserEnabledGuard $enabled,
        private AppPasswordService $appPasswords,
    ) {}

    public function validate(string $username, string $password, string $realm): bool
    {
        $auth = new PDOBasicAuth(DB::connection('wgw')->getPdo(), ['digestColumn' => 'digest']);
        $auth->setRealm($realm);
        if (! $auth->validateUserPass($username, $password)) {
            return false;
        }

        return $this->enabled->isEnabled($username);
    }

    /**
     * DAV and Meet Basic auth. An app password matches first. Otherwise the
     * account password is accepted. TOTP refusal is added when MFA lands.
     */
    public function validateProtocol(string $username, string $password, string $realm, ?string $client = null): bool
    {
        $username = strtolower(trim($username));
        if ($this->appPasswords->matches($username, $password, $client)) {
            return $this->enabled->isEnabled($username);
        }

        if (! $this->validate($username, $password, $realm)) {
            return false;
        }

        $this->touchDavPasswordUsed($username);

        return true;
    }

    private function touchDavPasswordUsed(string $username): void
    {
        $threshold = Carbon::now()->subSeconds(self::TOUCH_INTERVAL_SECONDS);
        User::query()
            ->where('username', $username)
            ->where(function ($query) use ($threshold): void {
                $query->whereNull('dav_password_used_at')->orWhere('dav_password_used_at', '<', $threshold);
            })
            ->update(['dav_password_used_at' => Carbon::now()]);
    }
}
