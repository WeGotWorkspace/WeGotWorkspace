<?php

declare(strict_types=1);

namespace App\Services\Auth;

/**
 * Enabling TOTP and confirming a replacement will bump session generation here.
 * The column is added with enforcement; until then confirmation still issues tokens.
 */
final class MfaSessionReissue
{
    public function afterAuthenticatorChanged(string $username): void
    {
        unset($username);
    }
}
