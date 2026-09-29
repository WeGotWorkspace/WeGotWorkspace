<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\DAVACL;

/**
 * Group principals under {@see GroupPrincipalContainer} are not user accounts, so no
 * request is authenticated as their owner URI. Grant read like {@see DAVACL\PrincipalCollection}.
 */
final class GroupMemberPrincipal extends DAVACL\Principal
{
    /**
     * @return list<array{privilege: string, principal: string, protected?: bool}>
     */
    public function getACL()
    {
        $acl = parent::getACL();
        $acl[] = [
            'privilege' => '{DAV:}read',
            'principal' => '{DAV:}authenticated',
            'protected' => true,
        ];

        return array_values($acl);
    }
}
