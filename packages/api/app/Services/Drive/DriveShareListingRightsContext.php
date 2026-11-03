<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Storage\StoragePaths;

final class DriveShareListingRightsContext
{
    /**
     * @param  array{scopeRoot: string|null, access: string, mayShare: bool}  $base
     * @param  (\Closure(string): array{mayView: bool, mayComment: bool, mayReview: bool, mayEditContent: bool, mayManageStructure: bool, mayShare: bool})|null  $entryRights
     */
    public function __construct(
        private array $base,
        private DriveSharePathScope $scope,
        private CollabDocFormats $collabDocFormats,
        private StoragePaths $paths,
        private ?\Closure $entryRights = null,
    ) {}

    /**
     * `/users` and `/groups` list every home and group drive (the share directory is
     * instance-wide); each entry carries the caller's own rights on it.
     */
    public function listsEveryEntry(): bool
    {
        return $this->entryRights !== null;
    }

    /**
     * @return array{
     *   mayView: bool,
     *   mayComment: bool,
     *   mayReview: bool,
     *   mayEditContent: bool,
     *   mayManageStructure: bool,
     *   mayShare: bool
     * }
     */
    public function rightsFor(string $virtualPath): array
    {
        $path = $this->scope->normalize($virtualPath);
        if ($this->entryRights !== null) {
            return ($this->entryRights)($path);
        }
        $scopeRoot = $this->base['scopeRoot'];
        if ($scopeRoot !== null && ! $this->scope->isWithin($scopeRoot, $path)) {
            return DriveShareAccess::none();
        }

        $mayShare = $this->base['mayShare'] && ! $this->scope->isTopLevelDrive($path);

        return DriveShareAccess::rightsFor(
            $this->base['access'],
            $this->collabDocFormats->isCollabDocPath($path),
            $mayShare,
            $this->paths->isNotePath($path),
        );
    }
}
