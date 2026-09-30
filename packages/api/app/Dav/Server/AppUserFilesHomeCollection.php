<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Dav\Storage\FlysystemAclCollection;
use App\Storage\WgwStorage;
use Sabre\DAV;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAVACL\FS\HomeCollection;
use Sabre\DAVACL\PrincipalBackend\BackendInterface;
use Sabre\Uri;

/**
 * Built-in {@see HomeCollection} behaviour plus filtering for this app:
 * only expose account principals per {@see AccountPrincipalFilter}.
 * Listing only includes the signed-in user's directory (no enumeration of other accounts).
 */
final class AppUserFilesHomeCollection extends HomeCollection
{
    /** URL segment under {@code files/} (see {@see AppFilesRootCollection}). */
    public $collectionName = 'users';

    public function __construct(
        BackendInterface $principalBackend,
        string $storagePath,
        private readonly AuthPlugin $authPlugin,
        string $principalPrefix = 'principals',
    ) {
        parent::__construct($principalBackend, $storagePath, $principalPrefix);
    }

    /** @param array<string, mixed> $principalInfo */
    public function getChildForPrincipal(array $principalInfo): DAV\INode
    {
        $owner = $principalInfo['uri'];
        $acl = [
            [
                'privilege' => '{DAV:}all',
                'principal' => '{DAV:}owner',
                'protected' => true,
            ],
        ];

        [, $principalBaseName] = Uri\split($owner);
        $key = trim($this->storagePath, '/').'/'.$principalBaseName;
        $filesystem = app(WgwStorage::class)->files();
        if (! $filesystem->directoryExists($key)) {
            $filesystem->makeDirectory($key);
        }

        return new FlysystemAclCollection($filesystem, $key, $acl, $owner);
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
        if ($current === null || $current === '' || ($principalInfo['uri'] ?? '') !== $current) {
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
