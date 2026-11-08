<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Closure;
use Sabre\CalDAV\Principal\ProxyRead;
use Sabre\CalDAV\Principal\ProxyWrite;
use Sabre\CalDAV\Principal\User;
use Sabre\DAV;
use Sabre\DAVACL;
use Sabre\Uri;

/**
 * CalDAV {@see User} only lists calendar-proxy children. Group principals live under
 * {@code principals/groups/…}; this node lists those sub-principals for the WebDAV tree.
 *
 * Only Teams the viewer may see are listed or resolved: their own Teams, or every
 * Team for an admin (#1922). Another Team answers like an unknown one, so its
 * `group-member-set` is readable only by its members and by admins.
 */
final class GroupPrincipalContainer extends User
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

    public function getChild($name)
    {
        $path = $this->getPrincipalURL().'/'.$name;
        $principal = $this->principalBackend->getPrincipalByPath($path);
        $proxy = $name === 'calendar-proxy-read' || $name === 'calendar-proxy-write';
        if (! $principal || (! $proxy && ! ($this->visibleTeam)((string) $name))) {
            throw new DAV\Exception\NotFound('Node with name '.$name.' was not found');
        }
        if ($name === 'calendar-proxy-read') {
            return new ProxyRead($this->principalBackend, $this->principalProperties);
        }
        if ($name === 'calendar-proxy-write') {
            return new ProxyWrite($this->principalBackend, $this->principalProperties);
        }

        return new GroupMemberPrincipal($this->principalBackend, $principal);
    }

    /**
     * @return list<DAV\INode>
     */
    public function getChildren(): array
    {
        $r = [];
        if ($this->principalBackend->getPrincipalByPath($this->getPrincipalURL().'/calendar-proxy-read')) {
            $r[] = new ProxyRead($this->principalBackend, $this->principalProperties);
        }
        if ($this->principalBackend->getPrincipalByPath($this->getPrincipalURL().'/calendar-proxy-write')) {
            $r[] = new ProxyWrite($this->principalBackend, $this->principalProperties);
        }
        foreach ($this->principalBackend->getPrincipalsByPrefix($this->getPrincipalURL()) as $info) {
            [, $slug] = Uri\split((string) $info['uri']);
            if (($this->visibleTeam)((string) $slug)) {
                $r[] = new GroupMemberPrincipal($this->principalBackend, $info);
            }
        }

        return $r;
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

    public function childExists($name)
    {
        try {
            $this->getChild($name);

            return true;
        } catch (DAV\Exception\NotFound $e) {
            return false;
        }
    }
}
