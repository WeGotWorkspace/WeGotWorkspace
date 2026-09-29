<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Exceptions\ApiHttpException;
use App\Models\MailUserCredential;

final class MailCredentialService
{
    public function __construct(private MailSecretService $secrets) {}

    /**
     * @param  array{imapUsername: string, imapPassword: string}|null  $account
     */
    public static function isAccountConfigured(?array $account): bool
    {
        if ($account === null) {
            return false;
        }

        return trim($account['imapUsername']) !== '' && $account['imapPassword'] !== '';
    }

    /**
     * @return array{imapUsername: string, imapPassword: string}|null
     */
    public function loadAccount(string $username): ?array
    {
        $row = MailUserCredential::query()->find(strtolower(trim($username)));
        if ($row === null) {
            return null;
        }
        $secret = $this->secrets->readBinary();
        if ($secret === null) {
            return null;
        }

        return [
            'imapUsername' => trim((string) $row->imap_username),
            'imapPassword' => $this->decryptField((string) $row->password_enc, $username, $secret),
        ];
    }

    public function save(string $username, string $imapUsername, string $imapPassword): void
    {
        $this->secrets->ensureSecretFile();

        $existing = $this->loadAccount($username);
        $existingUsername = is_array($existing) ? $existing['imapUsername'] : '';
        $existingPassword = is_array($existing) ? $existing['imapPassword'] : '';

        $mergedUsername = $this->resolveImapUsername($username, $imapUsername, $existingUsername);
        $incomingPassword = trim($imapPassword);
        $mergedPassword = $incomingPassword !== '' ? $incomingPassword : $existingPassword;

        if ($mergedUsername === '') {
            throw new ApiHttpException(400, 'Mail username is required.', 'bad_request');
        }
        if ($mergedPassword === '') {
            throw new ApiHttpException(400, 'Mail password is required.', 'bad_request');
        }

        $secret = $this->secrets->readBinary();
        if ($secret === null) {
            throw new ApiHttpException(500, 'Could not initialize mail credential encryption secret.', 'server_error');
        }

        $normalizedUser = strtolower(trim($username));
        MailUserCredential::query()->updateOrInsert(
            ['username' => $normalizedUser],
            [
                'username' => $normalizedUser,
                'imap_username' => $mergedUsername,
                'password_enc' => $this->encryptField($mergedPassword, $normalizedUser, $secret),
                'updated_at' => now()->toDateTimeString(),
            ]
        );
    }

    /**
     * Resolve the mailbox login to store or use for IMAP/SMTP.
     * Submitted and stored values win over the profile email so mail login can differ from Settings profile.
     */
    public function resolveImapUsername(string $username, string $submitted = '', string $stored = ''): string
    {
        $submitted = trim($submitted);
        if ($submitted !== '') {
            return $submitted;
        }

        $stored = trim($stored);
        if ($stored !== '') {
            return $stored;
        }

        return trim(MailPrincipalIdentityService::fetch($username)['emailAddress']);
    }

    /**
     * @param  array{imapUsername: string, imapPassword: string}|null  $account
     */
    public function effectiveImapUsername(string $username, ?array $account): string
    {
        $stored = trim((string) ($account['imapUsername'] ?? ''));
        if ($stored !== '') {
            return $stored;
        }

        return trim(MailPrincipalIdentityService::fetch($username)['emailAddress']);
    }

    private function key(string $username, string $secret): string
    {
        return substr(hash('sha256', $secret.'|mail|'.strtolower(trim($username)), true), 0, 32);
    }

    private function encryptField(string $plain, string $username, string $secret): string
    {
        if ($plain === '') {
            return '';
        }
        if (! function_exists('openssl_encrypt')) {
            throw new ApiHttpException(500, 'openssl extension required to store mail passwords.', 'server_error');
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', $this->key($username, $secret), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($cipher === false) {
            throw new ApiHttpException(500, 'Could not encrypt mail password.', 'server_error');
        }

        return base64_encode($iv.$tag.$cipher);
    }

    private function decryptField(string $blob, string $username, string $secret): string
    {
        if ($blob === '' || ! function_exists('openssl_decrypt')) {
            return '';
        }
        $raw = base64_decode($blob, true);
        if ($raw === false || strlen($raw) < 29) {
            return '';
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $ct = substr($raw, 28);
        $pt = openssl_decrypt($ct, 'aes-256-gcm', $this->key($username, $secret), OPENSSL_RAW_DATA, $iv, $tag);

        return is_string($pt) ? $pt : '';
    }
}
