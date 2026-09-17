<?php

declare(strict_types=1);

namespace App\Services\Mail;

final class MailUserRuntime
{
    public const ERROR_SETTINGS_MISSING = 'MAIL_SETTINGS_MISSING';

    public const ERROR_IMAP_EXTENSION = 'imap_extension_required';

    /**
     * User mailbox account is ready (this user's endpoints + login).
     *
     * @param  array<string, mixed>|null  $account
     */
    public static function isReady(?array $account): bool
    {
        return MailCredentialService::isAccountConfigured($account);
    }

    /**
     * @return array{
     *   displayName: string,
     *   emailAddress: string,
     *   mailAccountId: string,
     *   imap: array{host: string, port: int, security: string, username: string, password: string},
     *   smtp: array{host: string, port: int, security: string, username: string, password: string}
     * }|null
     */
    public static function resolve(string $username, MailCredentialService $credentials): ?array
    {
        $account = $credentials->loadAccount($username);
        if (! self::isReady($account)) {
            return null;
        }

        $identity = MailPrincipalIdentityService::fetch($username);
        $u = $credentials->effectiveImapUsername($username, $account);
        $p = (string) $account['imapPassword'];
        $smtpUser = trim((string) ($account['smtpUsername'] ?? ''));
        $smtpPass = (string) ($account['smtpPassword'] ?? '');
        if ($smtpUser === '') {
            $smtpUser = $u;
            $smtpPass = $p;
        }

        return [
            'displayName' => $identity['displayName'],
            'emailAddress' => $identity['emailAddress'],
            'mailAccountId' => MailCredentialService::MAIL_ACCOUNT_PRIMARY,
            'imap' => [
                'host' => (string) $account['imapHost'],
                'port' => (int) $account['imapPort'],
                'security' => (string) $account['imapSecurity'],
                'username' => $u,
                'password' => $p,
            ],
            'smtp' => [
                'host' => (string) $account['smtpHost'],
                'port' => (int) $account['smtpPort'],
                'security' => (string) $account['smtpSecurity'],
                'username' => $smtpUser,
                'password' => $smtpPass,
            ],
        ];
    }

    /**
     * Distinct status error: missing ext-imap vs user-empty mailbox.
     *
     * @param  array<string, mixed>|null  $account
     */
    public static function statusError(?array $account, bool $extImap): ?string
    {
        if (! $extImap) {
            return self::ERROR_IMAP_EXTENSION;
        }
        if (! self::isReady($account)) {
            return self::ERROR_SETTINGS_MISSING;
        }

        return null;
    }
}
