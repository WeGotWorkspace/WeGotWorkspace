<?php

declare(strict_types=1);

namespace Tests\Support;

/**
 * Live IMAP (Dovecot) + SMTP (Mailhog) fixture from compose profile `mail`.
 * Feature tests that need a real mailbox skip when nothing is listening.
 */
final class ImapFixture
{
    public static function host(): string
    {
        $host = getenv('WGW_IMAP_FIXTURE_HOST');

        return is_string($host) && $host !== '' ? $host : '127.0.0.1';
    }

    public static function imapPort(): int
    {
        $port = getenv('WGW_IMAP_FIXTURE_PORT');

        return is_string($port) && ctype_digit($port) ? (int) $port : 1143;
    }

    public static function smtpPort(): int
    {
        $port = getenv('WGW_SMTP_FIXTURE_PORT');

        return is_string($port) && ctype_digit($port) ? (int) $port : 1025;
    }

    public static function username(): string
    {
        $user = getenv('WGW_IMAP_FIXTURE_USER');

        return is_string($user) && $user !== '' ? $user : 'bob@example.test';
    }

    public static function password(): string
    {
        $pass = getenv('WGW_IMAP_FIXTURE_PASSWORD');

        return is_string($pass) && $pass !== '' ? $pass : 'mail-secret';
    }

    public static function available(): bool
    {
        if (! extension_loaded('imap')) {
            return false;
        }

        $errno = 0;
        $errstr = '';
        $fp = @fsockopen(self::host(), self::imapPort(), $errno, $errstr, 0.4);
        if ($fp === false) {
            return false;
        }
        fclose($fp);

        return true;
    }

    public static function smtpAvailable(): bool
    {
        $errno = 0;
        $errstr = '';
        $fp = @fsockopen(self::host(), self::smtpPort(), $errno, $errstr, 0.4);
        if ($fp === false) {
            return false;
        }
        fclose($fp);

        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public static function endpoints(?string $username = null): array
    {
        return [
            'imapHost' => self::host(),
            'imapPort' => self::imapPort(),
            'imapSecurity' => 'none',
            'smtpHost' => self::host(),
            'smtpPort' => self::smtpPort(),
            'smtpSecurity' => 'none',
            'imapUsername' => $username ?? self::username(),
            'imapPassword' => self::password(),
        ];
    }
}
