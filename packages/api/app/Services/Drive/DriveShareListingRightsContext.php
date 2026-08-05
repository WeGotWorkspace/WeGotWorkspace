<?php

declare(strict_types=1);

namespace App\Services\Drive;

final class DriveShareListingRightsContext
{
    /**
     * @param  array{scopeRoot: string|null, access: string, mayShare: bool}  $base
     */
    public function __construct(
        private array $base,
        private DriveSharePathScope $scope,
        private CollabDocFormats $collabDocFormats,
    ) {}

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
        $scopeRoot = $this->base['scopeRoot'];
        if ($scopeRoot !== null && ! $this->scope->isWithin($scopeRoot, $path)) {
            return [
                'mayView' => false,
                'mayComment' => false,
                'mayReview' => false,
                'mayEditContent' => false,
                'mayManageStructure' => false,
                'mayShare' => false,
            ];
        }

        $mayShare = $this->base['mayShare'] && ! $this->scope->isTopLevelDrive($path);

        return DriveShareAccess::rightsFor(
            $this->base['access'],
            $this->collabDocFormats->isCollabDocPath($path),
            $mayShare,
        );
    }
}
