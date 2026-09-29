<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Storage\WgwStorage;
use Sabre\DAV;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAVACL\AbstractPrincipalCollection;
use Sabre\DAVACL\ACLTrait;
use Sabre\DAVACL\IACL;
use Sabre\DAVACL\PrincipalBackend\BackendInterface;
use Sabre\Uri;

/**
 * One WebDAV collection per group principal under {@code principals/groups/{name}}.
 * Listing only includes groups the current principal is a member of.
 */
final class GroupFilesPrincipalCollection extends AbstractPrincipalCollection implements IACL
{
    use ACLTrait;

    public string $collectionName = 'groups';

    public function __construct(
        BackendInterface $principalBackend,
        private readonly string $storagePath,
        private readonly AuthPlugin $authPlugin,
    ) {
        parent::__construct($principalBackend, 'principals/groups');
    }

    public function getName(): string
    {
        return $this->collectionName;
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
        foreach ($this->principalBackend->getGroupMembership($current) as $groupUri) {
            if (! str_starts_with($groupUri, $this->principalPrefix.'/')) {
                continue;
            }
            $principalInfo = $this->principalBackend->getPrincipalByPath($groupUri);
            if ($principalInfo) {
                $children[] = $this->getChildForPrincipal($principalInfo);
            }
        }

        return $children;
    }

    public function getChild($name): DAV\INode
    {
        $principalInfo = $this->principalBackend->getPrincipalByPath($this->principalPrefix.'/'.$name);
        if (! $principalInfo) {
            throw new DAV\Exception\NotFound('Principal with name '.$name.' not found');
        }
        $current = $this->authPlugin->getCurrentPrincipal();
        if ($current === null || $current === '' || ! $this->principalIsMemberOfGroup($current, $principalInfo['uri'])) {
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

        return $this->principalIsMemberOfGroup($current, $principalInfo['uri']);
    }

    /** @param array<string, mixed> $principalInfo */
    public function getChildForPrincipal(array $principalInfo): DAV\INode
    {
        $uri = $principalInfo['uri'];
        [, $slug] = Uri\split($uri);
        if ($slug === null || $slug === '') {
            throw new DAV\Exception\NotFound('Invalid group principal');
        }
        $key = trim($this->storagePath, '/').'/'.$slug;
        $filesystem = app(WgwStorage::class)->files();
        if (! $filesystem->directoryExists($key)) {
            $filesystem->makeDirectory($key);
        }

        return new GroupSharedCollection($filesystem, $key, $uri);
    }

    private function principalIsMemberOfGroup(string $memberPrincipalUri, string $groupPrincipalUri): bool
    {
        foreach ($this->principalBackend->getGroupMembership($memberPrincipalUri) as $g) {
            if ($g === $groupPrincipalUri) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return list<array{privilege: string, principal: string, protected?: bool}>
     */
    public function getACL(): array
    {
        return [
            [
                'principal' => '{DAV:}authenticated',
                'privilege' => '{DAV:}read',
                'protected' => true,
            ],
        ];
    }
}
