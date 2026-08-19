<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Admin\AdminConstants;
use Sabre\CalDAV\Principal\Collection as CalDAVPrincipalCollection;
use Sabre\CalDAV\Principal\User;
use Sabre\DAV;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAVACL\PrincipalBackend\BackendInterface;
use Sabre\Uri;

/**
 * Uses {@see GroupPrincipalContainer} for the {@see AdminConstants::GROUP_CONTAINER_URI} branch
 * so nested group principals appear in the DAV tree (stock CalDAV {@code User} only exposes proxies).
 * Listing under {@code principals/} is limited to the signed-in account plus the {@code groups} container.
 * {@see getChild} still resolves any account principal so CalDAV scheduling (RFC 6638) can
 * read the attendee inbox and default calendar without enumerating other users.
 */
final class AppCalDAVPrincipalCollection extends CalDAVPrincipalCollection
{
    public function __construct(
        BackendInterface $principalBackend,
        private readonly AuthPlugin $authPlugin,
        string $principalPrefix = 'principals',
    ) {
        parent::__construct($principalBackend, $principalPrefix);
    }

    /**
     * @return list<DAV\INode>
     */
    public function getChildren(): array
    {
        if ($this->disableListing) {
            throw new DAV\Exception\MethodNotAllowed('Listing members of this collection is disabled');
        }
        $current = $this->authPlugin->getCurrentPrincipal();
        if ($current === null || $current === '') {
            return [];
        }
        $children = [];
        $ownInfo = $this->principalBackend->getPrincipalByPath($current);
        if ($ownInfo && AccountPrincipalFilter::isAccountPrincipal($ownInfo)) {
            $children[] = $this->getChildForPrincipal($ownInfo);
        }
        $groupsInfo = $this->principalBackend->getPrincipalByPath(AdminConstants::GROUP_CONTAINER_URI);
        if ($groupsInfo) {
            $children[] = $this->getChildForPrincipal($groupsInfo);
        }

        return $children;
    }

    public function getChild($name): DAV\INode
    {
        if ($name === $this->groupsDirectoryName()) {
            $principalInfo = $this->principalBackend->getPrincipalByPath(AdminConstants::GROUP_CONTAINER_URI);
            if (! $principalInfo) {
                throw new DAV\Exception\NotFound('Node with name '.$name.' was not found');
            }

            return $this->getChildForPrincipal($principalInfo);
        }

        $principalInfo = $this->principalBackend->getPrincipalByPath($this->principalPrefix.'/'.$name);
        if (! $principalInfo || ! AccountPrincipalFilter::isAccountPrincipal($principalInfo)) {
            throw new DAV\Exception\NotFound('Node with name '.$name.' was not found');
        }

        return $this->getChildForPrincipal($principalInfo);
    }

    public function childExists($name): bool
    {
        if ($name === $this->groupsDirectoryName()) {
            return (bool) $this->principalBackend->getPrincipalByPath(AdminConstants::GROUP_CONTAINER_URI);
        }
        $principalInfo = $this->principalBackend->getPrincipalByPath($this->principalPrefix.'/'.$name);
        if (! $principalInfo) {
            return false;
        }

        return AccountPrincipalFilter::isAccountPrincipal($principalInfo);
    }

    /**
     * @return list<string>
     */
    public function searchPrincipals(array $searchProperties, $test = 'allof')
    {
        $names = parent::searchPrincipals($searchProperties, $test);

        return array_values(array_filter($names, fn (string $n): bool => $this->childExists($n)));
    }

    /**
     * @return User|GroupPrincipalContainer
     */
    public function getChildForPrincipal(array $principalInfo)
    {
        if (($principalInfo['uri'] ?? '') === AdminConstants::GROUP_CONTAINER_URI) {
            return new GroupPrincipalContainer($this->principalBackend, $principalInfo);
        }

        return parent::getChildForPrincipal($principalInfo);
    }

    private function groupsDirectoryName(): string
    {
        [, $name] = Uri\split(AdminConstants::GROUP_CONTAINER_URI);

        return $name ?? 'groups';
    }
}
