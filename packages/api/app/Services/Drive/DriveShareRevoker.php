<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Models\DriveShareSession;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\StoragePaths;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Revokes shares: sets `revoked_at` and ends their guest sessions. A revoked share stays revoked,
 * so its public link answers 410 and its grants and invites resolve to nothing. Callers own the
 * transaction.
 *
 * Deleting a user or group also ends what was shared with it, so a new account or group under
 * the same name starts with nothing.
 */
final class DriveShareRevoker
{
    public function __construct(
        private DriveSharePathScope $scope,
        private FileNodeIndexService $fileNodes,
        private StoragePaths $paths,
    ) {}

    public function revoke(DriveShare $share): void
    {
        $now = Carbon::now();
        $share->revoked_at = $now;
        $share->save();

        DriveShareSession::query()
            ->where('share_id', $share->id)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => $now]);

        $this->recordShareChange((string) $share->path);
    }

    /**
     * The node at $virtualPath takes a new change_seq, so FileNode/changes
     * reports its new share flags (#2063).
     */
    public function recordShareChange(string $virtualPath): void
    {
        $this->fileNodes->recordShareChange($this->paths->virtualToStorageKey($virtualPath));
    }

    /**
     * Revokes every share on $virtualPath or below it, whoever owns it.
     */
    public function revokeAllUnderPath(string $virtualPath): int
    {
        $path = $this->scope->normalize($virtualPath);
        if ($path === '' || $path === '/') {
            return 0;
        }

        // LIKE is a coarse filter (_ / % are wildcards); the prefix check below is authoritative.
        /** @var Collection<int, DriveShare> $shares */
        $shares = DriveShare::query()
            ->whereNull('revoked_at')
            ->where(function ($query) use ($path): void {
                $query->where('path', $path)
                    ->orWhere('path', 'like', $path.'/%');
            })
            ->lockForUpdate()
            ->get();

        $count = 0;
        foreach ($shares as $share) {
            $sharePath = $this->scope->normalize((string) $share->path);
            if ($sharePath !== $path && ! str_starts_with($sharePath, $path.'/')) {
                continue;
            }
            $this->revoke($share);
            $count++;
        }

        return $count;
    }

    /**
     * Revokes every share $username owns, wherever it is.
     */
    public function revokeAllOwnedBy(string $username): int
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            return 0;
        }

        /** @var Collection<int, DriveShare> $shares */
        $shares = DriveShare::query()
            ->whereNull('revoked_at')
            ->where('owner_username', $username)
            ->lockForUpdate()
            ->get();

        foreach ($shares as $share) {
            $this->revoke($share);
        }

        return $shares->count();
    }

    /**
     * Removes the member grants made to $username on other people's shares.
     */
    public function removeGrantsToUser(string $username): int
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            return 0;
        }

        $query = DriveShareGrant::query()
            ->where('grantee_type', 'user')
            ->where('grantee_user', $username);
        $sharePaths = $this->sharePathsOf($query);
        $removed = $query->delete();
        foreach ($sharePaths as $path) {
            $this->recordShareChange($path);
        }

        return $removed;
    }

    /**
     * Removes the group grants made to the group $slug.
     */
    public function removeGrantsToGroup(string $slug): int
    {
        $slug = trim($slug);
        if ($slug === '') {
            return 0;
        }

        $query = DriveShareGrant::query()
            ->where('grantee_type', 'group')
            ->where('grantee_group', $slug);
        $sharePaths = $this->sharePathsOf($query);
        $removed = $query->delete();
        foreach ($sharePaths as $path) {
            $this->recordShareChange($path);
        }

        return $removed;
    }

    /**
     * @param  Builder<DriveShareGrant>  $grants
     * @return list<string> distinct paths of the shares those grants belong to
     */
    private function sharePathsOf(Builder $grants): array
    {
        return array_values(DriveShare::query()
            ->whereIn('id', (clone $grants)->select('share_id'))
            ->distinct()
            ->pluck('path')
            ->map(static fn (mixed $path): string => (string) $path)
            ->all());
    }
}
