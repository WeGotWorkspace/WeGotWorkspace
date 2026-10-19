<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\GroupMember;

final class AdminRoleResolver
{
    public const ADMIN_GROUP_URI = 'principals/groups/administrators';

    /** @var array<string, bool> */
    private array $adminCache = [];

    public function isAdmin(string $username): bool
    {
        return $this->adminCache[$username] ??= GroupMember::query()
            ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
            ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
            ->where('g.uri', self::ADMIN_GROUP_URI)
            ->where('m.uri', 'principals/'.$username)
            ->exists();
    }
}
