<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Support\WgwSettings;

final class MailUserRuntime
{
    /**
     * @param  array<string, mixed>  $cfg
     * @param  array{imapUsername: string, imapPassword: string}|null  $account
     */
    public static function isReady(array $cfg, ?array $account): bool
    {
        return MailServerSettings::serversConfigured($cfg)
            && MailCredentialService::isAccountConfigured($account);
    }

    /**
     * @return array{
     *   displayName: string,
     *   emailAddress: string,
     *   imap: array{host: string, port: int, security: string, username: string, password: string},
     *   smtp: array{host: string, port: int, security: string, username: string, password: string}
     * }|null
     */
    /**
     * @return array{displayName: string, emailAddress: string, imap: array{host: string, port: int, security: string, username: string, password: string}, smtp: array{host: string, port: int, security: string, username: string, password: string}}|null
     */
    public static function resolve(string $username, MailCredentialService $credentials): ?array
    {
        $cfg = WgwSettings::normalized();
        $account = $credentials->loadAccount($username);
        if (! self::isReady($cfg, $account)) {
            return null;
        }

        if ($account === null) {
            return null;
        }
        $identity = MailPrincipalIdentityService::fetch($username);
        $end = MailServerSettings::endpoints($cfg);
        $u = $credentials->effectiveImapUsername($username, $account);
        $p = $account['imapPassword'];

        return [
            'displayName' => $identity['displayName'],
            'emailAddress' => $identity['emailAddress'],
            'imap' => [
                'host' => $end['imap']['host'],
                'port' => $end['imap']['port'],
                'security' => $end['imap']['security'],
                'username' => $u,
                'password' => $p,
            ],
            'smtp' => [
                'host' => $end['smtp']['host'],
                'port' => $end['smtp']['port'],
                'security' => $end['smtp']['security'],
                'username' => $u,
                'password' => $p,
            ],
        ];
    }
}
