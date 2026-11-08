<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Closure;
use Sabre\DAVACL;
use Sabre\Uri;

/**
 * Group principals under {@see GroupPrincipalContainer} are not user accounts, so no
 * request is authenticated as their owner URI. Grant read like {@see DAVACL\PrincipalCollection}.
 */
final class GroupMemberPrincipal extends DAVACL\Principal
{
    /**
     * @param  array<string, mixed>  $principalProperties
     * @param  Closure(string): bool  $visibleTeam  Team slug => may the viewer see it
     */
    public function __construct(
        DAVACL\PrincipalBackend\BackendInterface $principalBackend,
        array $principalProperties,
        private readonly Closure $visibleTeam,
    ) {
        parent::__construct($principalBackend, $principalProperties);
    }

    /**
     * Sabre resolves every parent group while it builds a user's privileges. A Team nested
     * in a Team the viewer may not see must not send that walk to a hidden node (#1922).
     */
    /**
     * @return list<string>
     */
    public function getGroupMembership()
    {
        return array_values(array_filter(
            parent::getGroupMembership(),
            function (string $uri): bool {
                [, $slug] = Uri\split($uri);

                return ($this->visibleTeam)((string) $slug);
            },
        ));
    }

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
