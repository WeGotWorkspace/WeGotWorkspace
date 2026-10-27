<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\AddressBookRoot;
use Sabre\CardDAV\Backend\BackendInterface;
use Sabre\DAV;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAVACL\PrincipalBackend\BackendInterface as PrincipalBackend;

/**
 * {@see AddressBookRoot} with per-request listing limited to the authenticated account.
 */
final class AppAddressBookRoot extends AddressBookRoot
{
    public function __construct(
        PrincipalBackend $principalBackend,
        BackendInterface $carddavBackend,
        private readonly AuthPlugin $authPlugin,
        string $principalPrefix = 'principals',
    ) {
        parent::__construct($principalBackend, $carddavBackend, $principalPrefix);
    }

    public function getChildForPrincipal(array $principal): AppAddressBookHome
    {
        return new AppAddressBookHome($this->carddavBackend, $principal['uri']);
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
        $principalInfo = $this->principalBackend->getPrincipalByPath($current);
        if (! $principalInfo || ! AccountPrincipalFilter::isAccountPrincipal($principalInfo)) {
            return [];
        }

        return [$this->getChildForPrincipal($principalInfo)];
    }

    public function getChild($name): DAV\INode
    {
        $principalInfo = $this->principalBackend->getPrincipalByPath($this->principalPrefix.'/'.$name);
        if (! $principalInfo || ! AccountPrincipalFilter::isAccountPrincipal($principalInfo)) {
            throw new DAV\Exception\NotFound('Principal with name '.$name.' not found');
        }
        $current = $this->authPlugin->getCurrentPrincipal();
        // No principal yet: return the home so the ACL plugin answers with a
        // 401 challenge, like the calendar root. A 404 here makes Apple Contacts
        // treat the home as missing and abort its sync (#1437).
        if ($current !== null && $current !== '' && ($principalInfo['uri'] ?? '') !== $current) {
            throw new DAV\Exception\NotFound('Principal with name '.$name.' not found');
        }

        return $this->getChildForPrincipal($principalInfo);
    }

    public function childExists($name): bool
    {
        $current = $this->authPlugin->getCurrentPrincipal();
        if ($current === null || $current === '') {
            return false;
        }
        $principalInfo = $this->principalBackend->getPrincipalByPath($this->principalPrefix.'/'.$name);
        if (! $principalInfo) {
            return false;
        }

        return AccountPrincipalFilter::isAccountPrincipal($principalInfo)
            && ($principalInfo['uri'] ?? '') === $current;
    }
}
