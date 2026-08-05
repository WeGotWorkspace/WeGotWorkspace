<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareSession;
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
        $username = strtolower(trim((string) ($principal['username'] ?? '')));
        $role = strtolower(trim((string) ($principal['role'] ?? 'guest')));

        if ($role !== 'guest') {
            $groupSlugs = $this->groups->allowedGroupSlugs($username);
            if ($this->paths->isPathAllowed($path, $username, $groupSlugs, false)) {
                $mayShare = ! $this->scope->isTopLevelDrive($path);

                return [
                    'scopeRoot' => null,
                    'access' => DriveShareAccess::FULL,
                    'rights' => DriveShareAccess::rightsFor(DriveShareAccess::FULL, true, $mayShare),
                ];
            }

            $grant = $this->grantResolver->resolveMemberGrant($username, $path, $groupSlugs);
            if ($grant !== null) {
                $isCollabDoc = $this->collabDocFormats->isCollabDocPath($path);

                return [
                    'scopeRoot' => $grant['rootPath'],
                    'access' => $grant['access'],
                    'rights' => DriveShareAccess::rightsFor($grant['access'], $isCollabDoc, false),
                ];
            }
        }

        if ($role === 'guest' && str_starts_with($username, 'share:')) {
            $sessionKey = substr($username, strlen('share:'));
            if ($sessionKey === false || $sessionKey === '') {
                $this->deny();
            }

            $session = $this->activeSession($sessionKey);
            $share = $session->share;
            if ($share === null) {
                $this->deny();
            }

            $rootPath = $this->scope->normalize((string) $share->path);
            if (! $this->scope->isWithin($rootPath, $path)) {
                $this->deny();
            }

            $access = (string) $share->default_access;
            $isCollabDoc = $this->collabDocFormats->isCollabDocPath($path);

            return [
                'scopeRoot' => $rootPath,
                'access' => $access,
                'rights' => DriveShareAccess::rightsFor($access, $isCollabDoc, false),
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

    private function deny(): never
    {
        throw new \InvalidArgumentException('Access denied for this path.');
    }
}
