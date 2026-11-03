<?php

declare(strict_types=1);

namespace App\Services\Settings;

use App\Models\Principal;
use App\Services\Mcp\McpEnabled;
use App\Support\ApiUrlBuilder;

final class SettingsStateService
{
    public function __construct(
        private GroupDirectoryService $groups,
        private ApiUrlBuilder $urls,
        private McpEnabled $mcp,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function forUsername(string $username): array
    {
        $principal = Principal::forUsername($username);
        $displayName = trim((string) ($principal->displayname ?? ''));
        $email = trim((string) ($principal->email ?? ''));

        return [
            'user' => [
                'username' => $username,
                'displayName' => $displayName !== '' ? $displayName : $username,
                'email' => $email,
            ],
            'groups' => $this->groups->groupsForUser($username),
            'logoutUrl' => $this->urls->logout(),
            'mcpEnabled' => $this->mcp->isOn(),
        ];
    }
}
