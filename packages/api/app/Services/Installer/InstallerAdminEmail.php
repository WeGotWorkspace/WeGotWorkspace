<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * Admin email rule shared with the installer UI (`isInstallerEmailValid`).
 * Same shape as PHP `FILTER_VALIDATE_EMAIL` for a normal address: a dotted
 * domain whose last label starts with a letter. Quoted locals and IP
 * literals are out of scope for this form.
 */
final class InstallerAdminEmail
{
    public const MAX_OCTETS = 320;

    private const PATTERN = ';^[a-z0-9!#$%&\'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&\'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9]*(?:-[a-z0-9]+)*$;i';

    public static function isValid(string $email): bool
    {
        $email = trim($email);
        if ($email === '' || strlen($email) > self::MAX_OCTETS) {
            return false;
        }

        return preg_match(self::PATTERN, $email) === 1;
    }
}
