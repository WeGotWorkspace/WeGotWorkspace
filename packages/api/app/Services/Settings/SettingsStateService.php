<?php

declare(strict_types=1);

namespace App\Services\Settings;

use App\Models\Principal;
use App\Services\Mail\MailCredentialService;
use App\Services\Mcp\McpEnabled;
use App\Support\ApiUrlBuilder;

final class SettingsStateService
{
    public function __construct(
        private GroupDirectoryService $groups,
        private MailCredentialService $mailCredentials,
        private ApiUrlBuilder $urls,
        private McpEnabled $mcp,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function forUsername(string $username): array
    {
        $principal = Principal::forUsername($username);
        $displayName = trim((string) ($principal?->displayname ?? ''));
        $email = trim((string) ($principal?->email ?? ''));

        $mail = $this->mailCredentials->loadAccount($username) ?? [
            'imapUsername' => '',
            'imapPassword' => '',
            'imapHost' => '',
            'imapPort' => 993,
            'imapSecurity' => 'ssl',
            'smtpHost' => '',
            'smtpPort' => 587,
            'smtpSecurity' => 'starttls',
            'smtpUsername' => '',
            'smtpPassword' => '',
        ];

        return [
            'user' => [
                'username' => $username,
                'displayName' => $displayName !== '' ? $displayName : $username,
                'email' => $email,
            ],
            'groups' => $this->groups->groupsForUser($username),
            'mail' => [
                'imapUsername' => $this->mailCredentials->effectiveImapUsername($username, $mail),
                'imapHasPassword' => ((string) ($mail['imapPassword'] ?? '')) !== '',
                'smtpUsername' => (string) ($mail['smtpUsername'] ?? ''),
                'smtpPasswordSet' => ((string) ($mail['smtpPassword'] ?? '')) !== '',
            ],
            'mailServer' => [
                'imapHost' => (string) ($mail['imapHost'] ?? ''),
                'imapPort' => (int) ($mail['imapPort'] ?? 993),
                'imapSecurity' => (string) ($mail['imapSecurity'] ?? 'ssl'),
                'smtpHost' => (string) ($mail['smtpHost'] ?? ''),
                'smtpPort' => (int) ($mail['smtpPort'] ?? 587),
                'smtpSecurity' => (string) ($mail['smtpSecurity'] ?? 'starttls'),
            ],
            'logoutUrl' => $this->urls->logout(),
            'mcpEnabled' => $this->mcp->isOn(),
        ];
    }
}
