<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;

/**
 * True when this user has an app password, or DAV has accepted the account password.
 * The setup wizard uses it to warn that the account password will stop working.
 */
final class DavClientWarning
{
    public function __construct(private AppPasswordService $appPasswords) {}

    public function applies(string $username): bool
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            return false;
        }
        if ($this->appPasswords->userHasAny($username)) {
            return true;
        }

        $usedAt = User::query()->where('username', $username)->value('dav_password_used_at');

        return $usedAt !== null;
    }
}
