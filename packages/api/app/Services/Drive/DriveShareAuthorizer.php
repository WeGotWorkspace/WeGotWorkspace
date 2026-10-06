<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareSession;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\StoragePaths;
use Illuminate\Support\Carbon;

final class DriveShareAuthorizer
{
    public function __construct(
        private StoragePaths $paths,
        private DriveGroupResolver $groups,
        private DriveShareGrantResolver $grantResolver,
        private DriveSharePathScope $scope,
        private CollabDocFormats $collabDocFormats,
        private FileNodeIndexService $fileNodes,
    ) {}

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function assertMayRead(string $virtualPath, array $principal): void
    {
        $rights = $this->effectiveRights($virtualPath, $principal);
        if (! $rights['mayView']) {
            $this->deny();
        }
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function assertMayEditContent(string $virtualPath, array $principal): void
    {
        $rights = $this->effectiveRights($virtualPath, $principal);
        if (! $rights['mayEditContent']) {
            $this->deny();
        }
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function assertMayComment(string $virtualPath, array $principal): void
    {
        $rights = $this->effectiveRights($virtualPath, $principal);
        if (! $rights['mayComment']) {
            $this->deny();
        }
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function assertMayManageStructure(string $virtualPath, array $principal): void
    {
        $rights = $this->effectiveRights($virtualPath, $principal);
        if (! $rights['mayManageStructure']) {
            $this->deny();
        }
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function assertMoveWithinScope(string $fromPath, string $toPath, array $principal): void
    {
        $from = $this->resolvePathContext($fromPath, $principal);
        $to = $this->resolvePathContext($toPath, $principal);

        if (! $from['rights']['mayManageStructure'] || ! $to['rights']['mayManageStructure']) {
            $this->deny();
        }
        if (($from['scopeRoot'] ?? null) !== ($to['scopeRoot'] ?? null)) {
            $this->deny();
        }
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array{
     *   mayView: bool,
     *   mayComment: bool,
     *   mayReview: bool,
     *   mayEditContent: bool,
     *   mayManageStructure: bool,
     *   mayShare: bool
     * }
     */
    public function effectiveRights(string $virtualPath, array $principal): array
    {
        return $this->resolvePathContext($virtualPath, $principal)['rights'];
    }

    /**
     * scopeRoot for the principal at this path (null = own/group tree). Throws (deny) when no access.
     *
     * @param  array{username: string, role: string}  $principal
     */
    public function scopeRootFor(string $virtualPath, array $principal): ?string
    {
        return $this->resolvePathContext($virtualPath, $principal)['scopeRoot'];
    }

    /**
     * True when the path is exactly the root of the grant/share the principal reaches it through.
     *
     * @param  array{username: string, role: string}  $principal
     */
    public function isGrantScopeRoot(string $virtualPath, array $principal): bool
    {
        try {
            $scopeRoot = $this->scopeRootFor($virtualPath, $principal);
        } catch (\InvalidArgumentException) {
            return false;
        }

        return $scopeRoot !== null && $scopeRoot === $this->scope->normalize($virtualPath);
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function assertNotGrantScopeRoot(string $virtualPath, array $principal): void
    {
        if ($this->isGrantScopeRoot($virtualPath, $principal)) {
            $this->deny();
        }
    }

    /**
     * Share owner when a non-guest principal reaches the path only through a member grant; else null.
     *
     * @param  array{username: string, role: string}  $principal
     */
    public function memberGrantOwner(string $virtualPath, array $principal): ?string
    {
        $path = $this->scope->normalize($virtualPath);
        $username = strtolower(trim((string) $principal['username']));
        if (strtolower(trim((string) $principal['role'])) === 'guest') {
            return null;
        }
        $groupSlugs = $this->groups->allowedGroupSlugs($username);
        if ($this->paths->isPathAllowed($path, $username, $groupSlugs, false)) {
            return null;
        }
        $grant = $this->grantResolver->resolveMemberGrant($username, $path, $groupSlugs);

        return $grant !== null ? $grant['ownerUsername'] : null;
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function listingRightsContext(array $principal, string $listingDir): DriveShareListingRightsContext
    {
        $context = $this->resolvePathContext($listingDir, $principal);
        $dir = $this->scope->normalize($listingDir);
        // Drive roots themselves are not shareable, but owners may still share children listed under them.
        $mayShareInListing = $context['rights']['mayShare']
            || ($context['access'] === DriveShareAccess::FULL && $this->scope->isTopLevelDrive($dir));

        return new DriveShareListingRightsContext(
            [
                'scopeRoot' => $context['scopeRoot'],
                'access' => $context['access'],
                'mayShare' => $mayShareInListing,
            ],
            $this->scope,
            $this->collabDocFormats,
            $this->paths,
        );
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array{
     *   scopeRoot: string|null,
     *   access: string,
     *   rights: array{
     *     mayView: bool,
     *     mayComment: bool,
     *     mayReview: bool,
     *     mayEditContent: bool,
     *     mayManageStructure: bool,
     *     mayShare: bool
     *   }
     * }
     */
    public function resolvePathContext(string $virtualPath, array $principal): array
    {
        $path = $this->scope->normalize($virtualPath);
        $username = strtolower(trim((string) $principal['username']));
        $role = strtolower(trim((string) $principal['role']));

        if ($role !== 'guest') {
            $groupSlugs = $this->groups->allowedGroupSlugs($username);
            if ($this->paths->isPathAllowed($path, $username, $groupSlugs, false)) {
                $mayShare = ! $this->scope->isTopLevelDrive($path);
                $isNotePath = $this->paths->isNotePath($path);

                return [
                    'scopeRoot' => null,
                    'access' => DriveShareAccess::FULL,
                    'rights' => DriveShareAccess::rightsFor(DriveShareAccess::FULL, true, $mayShare, $isNotePath),
                ];
            }

            $inherited = $this->inheritAttachmentContext($path, $principal);
            if ($inherited !== null) {
                return $inherited;
            }

            $grant = $this->grantResolver->resolveMemberGrant($username, $path, $groupSlugs);
            if ($grant !== null) {
                $isCollabDoc = $this->collabDocFormats->isCollabDocPath($path);
                $isNotePath = $this->paths->isNotePath($path);

                return [
                    'scopeRoot' => $grant['rootPath'],
                    'access' => $grant['access'],
                    'rights' => DriveShareAccess::rightsFor($grant['access'], $isCollabDoc, false, $isNotePath),
                ];
            }
        }

        if ($role === 'guest' && str_starts_with($username, 'share:')) {
            $inherited = $this->inheritAttachmentContext($path, $principal);
            if ($inherited !== null) {
                return $inherited;
            }

            $sessionKey = substr($username, strlen('share:'));
            if ($sessionKey === '') {
                $this->deny();
            }

            $session = $this->activeSession($sessionKey);
            $share = $session->share;
            if ($share === null) {
                $this->deny();
            }

            $rootPath = $this->scope->normalize((string) $share->path);
            if ($this->scope->isInProductTrash($rootPath)) {
                $this->deny();
            }
            if (! $this->scope->isWithin($rootPath, $path)) {
                $this->deny();
            }

            $access = (string) $share->default_access;
            $isCollabDoc = $this->collabDocFormats->isCollabDocPath($path);
            $isNotePath = $this->paths->isNotePath($path);

            return [
                'scopeRoot' => $rootPath,
                'access' => $access,
                'rights' => DriveShareAccess::rightsFor($access, $isCollabDoc, false, $isNotePath),
            ];
        }

        $this->deny();
    }

    private function activeSession(string $sessionKey): DriveShareSession
    {
        /** @var DriveShareSession|null $session */
        $session = DriveShareSession::query()
            ->with('share')
            ->where('session_key', $sessionKey)
            ->whereNull('revoked_at')
            ->first();

        if ($session === null || $session->share === null) {
            $this->deny();
        }

        $now = Carbon::now();
        if ($session->expires_at->lessThanOrEqualTo($now)) {
            $this->deny();
        }

        /** @var DriveShare $share */
        $share = $session->share;
        if ($share->revoked_at !== null) {
            $this->deny();
        }
        if ($share->expires_at !== null && $share->expires_at->lessThanOrEqualTo($now)) {
            $this->deny();
        }

        return $session;
    }

    /**
     * Paths under `/{users|groups}/{principal}/.attachments/{docNodeId}/` inherit
     * the Doc FileNode's current rights. Editors may also manage files in that
     * prefix (upload/GC) without gaining mayShare on the hidden tree.
     *
     * @param  array{username: string, role: string}  $principal
     * @return array{
     *   scopeRoot: string|null,
     *   access: string,
     *   rights: array{
     *     mayView: bool,
     *     mayComment: bool,
     *     mayReview: bool,
     *     mayEditContent: bool,
     *     mayManageStructure: bool,
     *     mayShare: bool
     *   }
     * }|null
     */
    private function inheritAttachmentContext(string $path, array $principal): ?array
    {
        $parsed = DocAttachmentPaths::parseStorageKey($this->paths->virtualToStorageKey($path));
        if ($parsed === null) {
            return null;
        }
        $doc = $this->fileNodes->liveByNodeId($parsed['docNodeId']);
        if ($doc === null) {
            return null;
        }
        if (DocAttachmentPaths::parseStorageKey((string) $doc->storage_key) !== null) {
            return null;
        }

        $context = $this->resolvePathContext('/'.ltrim((string) $doc->storage_key, '/'), $principal);
        $rights = $context['rights'];
        if ($rights['mayEditContent']) {
            $rights['mayManageStructure'] = true;
        }
        $rights['mayShare'] = false;

        return [
            'scopeRoot' => $context['scopeRoot'],
            'access' => $context['access'],
            'rights' => $rights,
        ];
    }

    private function deny(): never
    {
        throw new \InvalidArgumentException('Access denied for this path.');
    }
}
