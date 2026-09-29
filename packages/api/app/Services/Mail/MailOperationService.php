<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Support\WgwSettings;

final class MailOperationService
{
    public function __construct(
        private MailCredentialService $credentials,
        private MailFolderOperations $folders,
        private MailMessageOperations $messages,
        private MailComposeOperations $compose,
    ) {}

    /** @return array<string, mixed> */
    public function status(string $username): array
    {
        return $this->handleStatus($username);
    }

    /** @return array<string, mixed> */
    public function listFolders(string $username): array
    {
        return MailImapProcess::runJson('listFolders', $username, [], fn () => $this->folders->handleFolders($username));
    }

    /** @param array<string, mixed> $body */
    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function createFolder(string $username, array $body): array
    {
        return MailImapProcess::runJson('createFolder', $username, $body, fn () => $this->folders->handleFolderCreate($username, $body));
    }

    /** @param array<string, mixed> $body */
    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function moveFolder(string $username, array $body): array
    {
        return MailImapProcess::runJson('moveFolder', $username, $body, fn () => $this->folders->handleFolderMove($username, $body));
    }

    /** @param array<string, mixed> $body */
    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function deleteFolder(string $username, array $body): array
    {
        return MailImapProcess::runJson('deleteFolder', $username, $body, fn () => $this->folders->handleFolderDelete($username, $body));
    }

    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>
     */
    public function listMessages(string $username, array $query): array
    {
        return MailImapProcess::runJson('listMessages', $username, $query, fn () => $this->messages->handleMessages($username, $query));
    }

    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>
     */
    public function listMessageAttachments(string $username, array $query): array
    {
        return MailImapProcess::runJson(
            'listMessageAttachments',
            $username,
            $query,
            fn () => $this->messages->handleMessageAttachments($username, $query),
        );
    }

    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>
     */
    public function getMessage(string $username, array $query): array
    {
        return MailImapProcess::runJson('getMessage', $username, $query, fn () => $this->messages->handleMessageGet($username, $query));
    }

    /** @param array<string, mixed> $query */
    public function downloadAttachment(string $username, array $query): MailBinaryDownload
    {
        return MailImapProcess::runBinary(
            'downloadAttachment',
            $username,
            $query,
            fn () => $this->messages->handleMessageAttachmentDownload($username, $query),
        );
    }

    /** @param array<string, mixed> $body */
    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function patchMessage(string $username, array $body): array
    {
        return MailImapProcess::runJson('patchMessage', $username, $body, fn () => $this->messages->handleMessagePatch($username, $body));
    }

    /** @param array<string, mixed> $query */
    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>
     */
    public function deleteMessage(string $username, array $query): array
    {
        return MailImapProcess::runJson('deleteMessage', $username, $query, fn () => $this->messages->handleMessageDelete($username, $query));
    }

    /** @param array<string, mixed> $body */
    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function moveMessage(string $username, array $body): array
    {
        return MailImapProcess::runJson('moveMessage', $username, $body, fn () => $this->messages->handleMove($username, $body));
    }

    /** @param array<string, mixed> $body */
    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function send(string $username, array $body): array
    {
        return MailImapProcess::runJson('send', $username, $body, fn () => $this->compose->handleSend($username, $body));
    }

    /** @param array<string, mixed> $body */
    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function saveDraft(string $username, array $body): array
    {
        return MailImapProcess::runJson('saveDraft', $username, $body, fn () => $this->compose->handleSaveDraft($username, $body));
    }

    /** @return array<mixed> */
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
}
