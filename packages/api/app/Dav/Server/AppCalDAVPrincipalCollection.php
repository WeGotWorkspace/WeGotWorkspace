<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Admin\AdminConstants;
use App\Services\Teams\TeamColleagues;
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
 * {@see getChild} resolves the signed-in account's colleagues only ({@see TeamColleagues::isColleague},
 * so admins reach everyone); anyone else answers like an unknown account (#1922). The principal
 * backend itself stays unfiltered.
 */
final class AppCalDAVPrincipalCollection extends CalDAVPrincipalCollection
{
    public function __construct(
        BackendInterface $principalBackend,
        private readonly AuthPlugin $authPlugin,
        private readonly TeamColleagues $colleagues,
        private readonly CalDavDeliveryRecipients $deliveryRecipients,
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
        if (! $principalInfo || ! AccountPrincipalFilter::isAccountPrincipal($principalInfo) || ! $this->mayResolve($principalInfo)) {
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

        return AccountPrincipalFilter::isAccountPrincipal($principalInfo) && $this->mayResolve($principalInfo);
    }

    /**
     * Directory search is least-privilege: only the signed-in account (plus groups).
     * {@see getChild} resolves colleagues only. The CalDAV schedule plugin reads a
     * known ATTENDEE's calendar-home-set and schedule-inbox through it, so local
     * delivery reaches colleagues without listing the user directory. Delivery to
     * someone outside the sender's Teams never gets here: the delivery guard
     * ({@see CalendarScheduleDeliveryGuardPlugin}, #1923) stops it first and opens
     * the node only for a delivery it lets through, such as a reply to an admin's
     * invite ({@see CalDavDeliveryRecipients}).
     *
     * @param  array<string, mixed>  $searchProperties
     * @return list<string>
     */
    public function searchPrincipals(array $searchProperties, $test = 'allof')
    {
        $current = $this->authPlugin->getCurrentPrincipal();
        $names = parent::searchPrincipals($searchProperties, $test);

        return array_values(array_filter($names, function (string $n) use ($current): bool {
            if ($n === $this->groupsDirectoryName()) {
                return (bool) $this->principalBackend->getPrincipalByPath(AdminConstants::GROUP_CONTAINER_URI);
            }
            $principalInfo = $this->principalBackend->getPrincipalByPath($this->principalPrefix.'/'.$n);
            if (! $principalInfo || ! AccountPrincipalFilter::isAccountPrincipal($principalInfo)) {
                return false;
            }

            return $current !== null && $current !== '' && ($principalInfo['uri'] ?? '') === $current;
        }));
    }

    /**
     * @param  array<string, mixed>  $principalInfo
     * @return User|GroupPrincipalContainer
     */
    public function getChildForPrincipal(array $principalInfo)
    {
        if (($principalInfo['uri'] ?? '') === AdminConstants::GROUP_CONTAINER_URI) {
            return new GroupPrincipalContainer($this->principalBackend, $principalInfo, $this->visibleTeam(...));
        }

        return parent::getChildForPrincipal($principalInfo);
    }

    /**
     * Own Teams for everyone; every Team for an admin (#1922).
     */
    private function visibleTeam(string $slug): bool
    {
        $current = $this->authPlugin->getCurrentPrincipal();
        $prefix = $this->principalPrefix.'/';
        if (! is_string($current) || ! str_starts_with($current, $prefix)) {
            return false;
        }
        $viewer = substr($current, strlen($prefix));

        return $this->colleagues->colleagues($viewer)->isUnrestricted() || $this->colleagues->isOwnTeam($viewer, $slug);
    }

    /**
     * @param  array<string, mixed>  $principalInfo
     */
    private function mayResolve(array $principalInfo): bool
    {
        $uri = (string) ($principalInfo['uri'] ?? '');
        $current = $this->authPlugin->getCurrentPrincipal();
        if (! is_string($current) || ! str_starts_with($current, $this->principalPrefix.'/')) {
            return false;
        }
        if ($uri === $current || $this->deliveryRecipients->allows($uri)) {
            return true;
        }
        $prefix = $this->principalPrefix.'/';

        return $this->colleagues->isColleague(substr($current, strlen($prefix)), substr($uri, strlen($prefix)));
    }

    private function groupsDirectoryName(): string
    {
        [, $name] = Uri\split(AdminConstants::GROUP_CONTAINER_URI);

        return $name ?? 'groups';
    }
}
