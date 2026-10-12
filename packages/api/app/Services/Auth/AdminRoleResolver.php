<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\GroupMember;

final class AdminRoleResolver
{
    public const ADMIN_GROUP_URI = 'principals/groups/administrators';

    public function isAdmin(string $username): bool
    {
        return GroupMember::query()
            ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
            ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
            ->where('g.uri', self::ADMIN_GROUP_URI)
            ->where('m.uri', 'principals/'.$username)
            ->exists();
    }

    /**
     * @return list<string>
     */
    public function adminUsernames(): array
    {
        $names = [];
        $uris = GroupMember::query()
            ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
            ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
            ->where('g.uri', self::ADMIN_GROUP_URI)
            ->pluck('m.uri');
        foreach ($uris as $uri) {
            if (! is_string($uri) || ! str_starts_with($uri, 'principals/') || str_contains($uri, '/groups/')) {
                continue;
            }
            $name = strtolower(substr($uri, strlen('principals/')));
            if ($name !== '') {
                $names[$name] = $name;
            }
        }

        return array_values($names);
    }
}
