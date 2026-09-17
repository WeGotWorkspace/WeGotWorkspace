<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Exceptions\ApiHttpException;
use App\Models\MailUserCredential;

final class MailCredentialService
{
    public const MAIL_ACCOUNT_PRIMARY = 'primary';

    public function __construct(private MailSecretService $secrets) {}

    /**
     * @param  array<string, mixed>|null  $account
     */
    public static function isAccountConfigured(?array $account): bool
    {
        if ($account === null) {
            return false;
        }

        return trim((string) ($account['imapUsername'] ?? '')) !== ''
            && (string) ($account['imapPassword'] ?? '') !== ''
            && trim((string) ($account['imapHost'] ?? '')) !== ''
            && trim((string) ($account['smtpHost'] ?? '')) !== '';
    }

    /**
     * @return array{
     *   imapUsername: string,
     *   imapPassword: string,
     *   imapHost: string,
     *   imapPort: int,
     *   imapSecurity: string,
     *   smtpHost: string,
     *   smtpPort: int,
     *   smtpSecurity: string,
     *   smtpUsername: string,
     *   smtpPassword: string
     * }|null
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
            'imapHost' => trim((string) ($row->imap_host ?? '')),
            'imapPort' => self::port((int) ($row->imap_port ?? 993), 993),
            'imapSecurity' => self::security((string) ($row->imap_security ?? 'ssl')),
            'smtpHost' => trim((string) ($row->smtp_host ?? '')),
            'smtpPort' => self::port((int) ($row->smtp_port ?? 587), 587),
            'smtpSecurity' => self::security((string) ($row->smtp_security ?? 'starttls')),
            'smtpUsername' => trim((string) ($row->smtp_username ?? '')),
            'smtpPassword' => $this->decryptField((string) ($row->smtp_password_enc ?? ''), $username, $secret),
        ];
    }

    /**
     * Legacy helper used by existing tests and the installer seed path.
     */
    public function save(string $username, string $imapUsername, string $imapPassword): void
    {
        $this->saveAccount($username, [
            'imapUsername' => $imapUsername,
            'imapPassword' => $imapPassword,
        ]);
    }

    /**
     * Partial PUT: omitted or empty passwords keep the stored secret unless a
     * clear* flag is set. Hosts/ports omitted keep stored values.
     *
     * @param  array<string, mixed>  $input
     */
    public function saveAccount(string $username, array $input): void
    {
        $this->secrets->ensureSecretFile();

        $existing = $this->loadAccount($username);
        $existingUsername = is_array($existing) ? $existing['imapUsername'] : '';
        $existingPassword = is_array($existing) ? $existing['imapPassword'] : '';
        $existingSmtpPassword = is_array($existing) ? $existing['smtpPassword'] : '';

        $mergedUsername = $this->resolveImapUsername(
            $username,
            trim((string) ($input['imapUsername'] ?? '')),
            $existingUsername,
        );

        $clearImap = (bool) ($input['clearImapPassword'] ?? false);
        $clearSmtp = (bool) ($input['clearSmtpPassword'] ?? false);
        $incomingPassword = trim((string) ($input['imapPassword'] ?? ''));
        $incomingSmtpPassword = array_key_exists('smtpPassword', $input)
            ? trim((string) $input['smtpPassword'])
            : null;

        $mergedPassword = $clearImap
            ? ''
            : ($incomingPassword !== '' ? $incomingPassword : $existingPassword);
        $mergedSmtpPassword = $clearSmtp
            ? ''
            : (($incomingSmtpPassword !== null && $incomingSmtpPassword !== '')
                ? $incomingSmtpPassword
                : $existingSmtpPassword);

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
                'imap_host' => $this->mergeString($input, 'imapHost', $existing['imapHost'] ?? ''),
                'imap_port' => $this->mergePort($input, 'imapPort', (int) ($existing['imapPort'] ?? 993), 993),
                'imap_security' => $this->mergeSecurity($input, 'imapSecurity', (string) ($existing['imapSecurity'] ?? 'ssl')),
                'smtp_host' => $this->mergeString($input, 'smtpHost', $existing['smtpHost'] ?? ''),
                'smtp_port' => $this->mergePort($input, 'smtpPort', (int) ($existing['smtpPort'] ?? 587), 587),
                'smtp_security' => $this->mergeSecurity($input, 'smtpSecurity', (string) ($existing['smtpSecurity'] ?? 'starttls')),
                'smtp_username' => $this->mergeString($input, 'smtpUsername', $existing['smtpUsername'] ?? ''),
                'smtp_password_enc' => $this->encryptField($mergedSmtpPassword, $normalizedUser, $secret),
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
     * @param  array{imapUsername?: string}|null  $account
     */
    public function effectiveImapUsername(string $username, ?array $account): string
    {
        $stored = trim((string) ($account['imapUsername'] ?? ''));
        if ($stored !== '') {
            return $stored;
        }

        return trim(MailPrincipalIdentityService::fetch($username)['emailAddress']);
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function mergeString(array $input, string $key, string $existing): string
    {
        if (! array_key_exists($key, $input) || $input[$key] === null) {
            return $existing;
        }

        return trim((string) $input[$key]);
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function mergePort(array $input, string $key, int $existing, int $fallback): int
    {
        if (! array_key_exists($key, $input) || $input[$key] === null || $input[$key] === '') {
            return self::port($existing, $fallback);
        }

        return self::port((int) $input[$key], $fallback);
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function mergeSecurity(array $input, string $key, string $existing): string
    {
        if (! array_key_exists($key, $input) || $input[$key] === null || $input[$key] === '') {
            return self::security($existing);
        }

        return self::security((string) $input[$key]);
    }

    public static function port(int $port, int $fallback): int
    {
        if ($port < 1 || $port > 65535) {
            return $fallback;
        }

        return $port;
    }

    public static function security(string $value): string
    {
        $s = strtolower(trim($value));

        return in_array($s, ['ssl', 'starttls', 'none'], true) ? $s : 'ssl';
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
