<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Owner and member share payloads, plus lifecycle used by ACL views.
 */
final class DriveSharePresenter
{
    public function __construct(
        private StoragePaths $paths,
        private DriveSharePathScope $scope,
        private CollabDocFormats $collabDocFormats,
        private WgwStorage $storage,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function serializeShareForOwner(DriveShare $share): array
    {
        $shareWith = [];
        /** @var Collection<int, DriveShareGrant> $grants */
        $grants = DriveShareGrant::query()
            ->where('share_id', $share->id)
            ->where('status', 'active')
            ->whereIn('grantee_type', ['user', 'group'])
            ->get();

        foreach ($grants as $grant) {
            if ($grant->grantee_type === 'user') {
                if ($grant->grantee_user === null || $grant->grantee_user === '') {
                    continue;
                }
                $shareWith[$grant->grantee_user] = ['access' => (string) $grant->access];

                continue;
            }

            if ($grant->grantee_type === 'group' && $grant->grantee_group !== null && $grant->grantee_group !== '') {
                $shareWith['groups/'.$grant->grantee_group] = ['access' => (string) $grant->access];
            }
        }

        return [
            'id' => (string) $share->id,
            'path' => (string) $share->path,
            'kind' => (string) $share->kind,
            'defaultAccess' => (string) $share->default_access,
            'publicToken' => $share->public_token,
            'hasPassword' => $share->password_hash !== null && $share->password_hash !== '',
            'expiresAt' => $share->expires_at?->toISOString(),
            'updatedAt' => $share->updated_at?->toISOString(),
            'shareWith' => $shareWith === [] ? null : $shareWith,
            'myRights' => DriveShareAccess::rightsFor(
                DriveShareAccess::FULL,
                true,
                true,
                $this->paths->isNotePath((string) $share->path),
            ),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function serializeShareForMember(DriveShare $share, string $grantAccess): array
    {
        $path = (string) $share->path;
        $isCollabDoc = $this->collabDocFormats->isCollabDocPath($path);
        $isNotePath = $this->paths->isNotePath($path);

        return [
            'id' => (string) $share->id,
            'path' => $path,
            'kind' => (string) $share->kind,
            'defaultAccess' => (string) $grantAccess,
            'publicToken' => null,
            'hasPassword' => $share->password_hash !== null && $share->password_hash !== '',
            'expiresAt' => $share->expires_at?->toISOString(),
            'updatedAt' => $share->updated_at?->toISOString(),
            'shareWith' => null,
            'myRights' => DriveShareAccess::rightsFor($grantAccess, $isCollabDoc, false, $isNotePath),
        ];
    }

    /**
     * Resolve listing metadata for a share root without requiring parent-directory access.
     *
     * @return array<string, mixed>|null
     */
    public function directoryEntryForSharePath(string $virtualPath, string $grantAccess): ?array
    {
        $path = $this->scope->normalize($virtualPath);
        if ($path === '' || $path === '/') {
            return null;
        }

        $disk = $this->filesDisk();
        $key = $this->paths->virtualToStorageKey($path);
        $isDir = $disk->directoryExists($key);
        if (! $isDir && ! $disk->fileExists($key)) {
            return null;
        }

        $isCollabDoc = $this->collabDocFormats->isCollabDocPath($path);
        $isNotePath = $this->paths->isNotePath($path);

        return [
            'type' => $isDir ? 'dir' : 'file',
            'path' => $path,
            'name' => basename($path),
            'size' => $isDir ? 0 : max(0, (int) ($disk->size($key) ?? 0)),
            'time' => max(0, (int) ($disk->lastModified($key) ?? time())),
            'permissions' => 0,
            'myRights' => DriveShareAccess::rightsFor($grantAccess, $isCollabDoc, false, $isNotePath),
        ];
    }

    public function shareLifecycleStatus(DriveShare $share): string
    {
        if ($share->expires_at !== null && $share->expires_at->lessThanOrEqualTo(Carbon::now())) {
            return 'expired';
        }

        return 'active';
    }

    public function isShareLive(DriveShare $share, Carbon $now): bool
    {
        if ($share->revoked_at !== null) {
            return false;
        }
        if ($share->expires_at !== null && $share->expires_at->lessThanOrEqualTo($now)) {
            return false;
        }

        return true;
    }

    /**
     * @return array{shareId: string, sharePath: string, inherited: bool, status: string}
     */
    public function grantSource(DriveShare $share, string $requestedPath): array
    {
        $sharePath = $this->scope->normalize((string) $share->path);

        return [
            'shareId' => (string) $share->id,
            'sharePath' => $sharePath,
            'inherited' => $sharePath !== $requestedPath,
            'status' => $this->shareLifecycleStatus($share),
        ];
    }

    private function filesDisk(): Filesystem
    {
        return $this->storage->files();
    }
}
