<?php

declare(strict_types=1);

namespace App\Services\Admin;

use App\Models\Principal;
use App\Models\User;
use App\Services\Settings\GroupDirectoryService;

final class AdminUserDirectoryService
{
    public function __construct(private GroupDirectoryService $groups) {}

    /**
     * @return list<array{id: string, username: string, email: string, displayName: string, groups: list<string>, createdAt: string, enabled: bool}>
     */
    public function listSummaries(): array
    {
        $groupMembers = [];
        foreach ($this->groups->listGroupSummaries() as $group) {
            $groupMembers[(string) $group['id']] = $this->groups->memberPrincipalUris((string) $group['id']);
        }

        $users = [];
        foreach (User::query()->orderBy('username')->get() as $user) {
            $username = (string) $user->username;
            $principal = 'principals/'.$username;
            $principalRow = Principal::forUsername($username);
            $memberOf = [];
            foreach ($groupMembers as $groupUri => $members) {
                if (in_array($principal, $members, true)) {
                    $memberOf[] = $groupUri;
                }
            }

            $users[] = [
                'id' => $username,
                'username' => $username,
                'email' => (string) ($principalRow?->email ?? ''),
                'displayName' => trim((string) ($principalRow?->displayname ?? '')) ?: $username,
                'groups' => $memberOf,
                'createdAt' => '',
                'enabled' => $user->isEnabled(),
            ];
        }

        return $users;
    }
}
