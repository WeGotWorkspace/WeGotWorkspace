<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Support\WgwSettings;
use IMAP\Connection;
use PHPMailer\PHPMailer\PHPMailer;

final class MailOperationService
{
    use MailFolderOperations;
    use MailMessageOperations;
    use MailComposeOperations;

    public function __construct(
        private MailCredentialService $credentials,
    ) {}

    /** @return array<string, mixed> */
    public function status(string $username): array
    {
        return $this->handleStatus($username);
    }

    /** @return array<string, mixed> */
    public function listFolders(string $username): array
    {
        return MailImapProcess::runJson('listFolders', $username, [], fn () => $this->handleFolders($username));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function createFolder(string $username, array $body): array
    {
        return MailImapProcess::runJson('createFolder', $username, $body, fn () => $this->handleFolderCreate($username, $body));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function moveFolder(string $username, array $body): array
    {
        return MailImapProcess::runJson('moveFolder', $username, $body, fn () => $this->handleFolderMove($username, $body));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function deleteFolder(string $username, array $body): array
    {
        return MailImapProcess::runJson('deleteFolder', $username, $body, fn () => $this->handleFolderDelete($username, $body));
    }

    /** @return array<string, mixed> */
    public function listMessages(string $username, array $query): array
    {
        return MailImapProcess::runJson('listMessages', $username, $query, fn () => $this->handleMessages($username, $query));
    }

    /** @return array<string, mixed> */
    public function listMessageAttachments(string $username, array $query): array
    {
        return MailImapProcess::runJson(
            'listMessageAttachments',
            $username,
            $query,
            fn () => $this->handleMessageAttachments($username, $query),
        );
    }

    /** @return array<string, mixed> */
    public function getMessage(string $username, array $query): array
    {
        return MailImapProcess::runJson('getMessage', $username, $query, fn () => $this->handleMessageGet($username, $query));
    }

    public function downloadAttachment(string $username, array $query): MailBinaryDownload
    {
        return MailImapProcess::runBinary(
            'downloadAttachment',
            $username,
            $query,
            fn () => $this->handleMessageAttachmentDownload($username, $query),
        );
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function patchMessage(string $username, array $body): array
    {
        return MailImapProcess::runJson('patchMessage', $username, $body, fn () => $this->handleMessagePatch($username, $body));
    }

    /** @param array<string, mixed> $query @return array<string, mixed> */
    public function deleteMessage(string $username, array $query): array
    {
        return MailImapProcess::runJson('deleteMessage', $username, $query, fn () => $this->handleMessageDelete($username, $query));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function moveMessage(string $username, array $body): array
    {
        return MailImapProcess::runJson('moveMessage', $username, $body, fn () => $this->handleMove($username, $body));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function send(string $username, array $body): array
    {
        return MailImapProcess::runJson('send', $username, $body, fn () => $this->handleSend($username, $body));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function saveDraft(string $username, array $body): array
    {
        return MailImapProcess::runJson('saveDraft', $username, $body, fn () => $this->handleSaveDraft($username, $body));
    }

    private function handleStatus(string $username): array
    {
        $cfg = WgwSettings::normalized();
        $account = $this->credentials->loadAccount($username);
        $ext = ImapExtension::loaded();
        $serversConfigured = MailServerSettings::serversConfigured($cfg);
        $accountConfigured = MailCredentialService::isAccountConfigured($account);
        $smtp = MailSmtpTransportConfig::normalize(MailServerSettings::endpoints($cfg)['smtp']);

        return [
            'extImap' => $ext,
            'serversConfigured' => $serversConfigured,
            'accountConfigured' => $accountConfigured,
            'ready' => $ext && MailUserRuntime::isReady($cfg, $account),
            'configured' => $accountConfigured,
            'smtp' => [
                'host' => $smtp['host'],
                'port' => $smtp['port'],
                'security' => $smtp['security'],
                'tcpReachable' => MailSmtpTransportConfig::canReachTcp($smtp['host'], $smtp['port']),
            ],
        ];
    }

    private function requireImap(string $username): array
    {
        if (! ImapExtension::loaded()) {
            throw new MailResponseException(503, ['error' => 'imap_extension_required']);
        }
        $cred = MailUserRuntime::resolve($username, $this->credentials);
        if ($cred === null) {
            throw new MailResponseException(400, ['error' => 'not_configured']);
        }

        return $cred;
    }

    public static function folderIdEncode(string $mailbox): string
    {
        return rtrim(strtr(base64_encode($mailbox), '+/', '-_'), '=');
    }

    public static function folderIdDecode(string $enc): string
    {
        if ($enc === '__starred__') {
            return '__starred__';
        }
        $b64 = strtr($enc, '-_', '+/');
        $pad = strlen($b64) % 4;
        if ($pad > 0) {
            $b64 .= str_repeat('=', 4 - $pad);
        }
        $raw = base64_decode($b64, true);

        return is_string($raw) ? $raw : '';
    }

    /**
     * @param  array{host: string, port: int, security: string, smtpAuth: bool}|null  $transport
     */
}
