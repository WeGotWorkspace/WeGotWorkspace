<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use Illuminate\Support\Collection;

/**
 * Share badges for many paths in one lookup: which of an owner's paths have a
 * live public link and which have a visible member grant. Drive listings and
 * FileNode/get (`shareFlags`, #2063) read the same answer.
 */
final class DriveShareIndicators
{
    public function __construct(
        private DriveSharePathScope $scope,
        private DriveShareGrantVisibility $grantVisibility,
    ) {}

    /**
     * @param  list<string>  $virtualPaths
     * @return array<string, array{hasPublicShare: bool, hasTeamShare: bool}>
     */
    public function forPaths(string $ownerUsername, array $virtualPaths): array
    {
        $owner = strtolower(trim($ownerUsername));
        if ($owner === '' || $virtualPaths === []) {
            return [];
        }

        $pathList = [];
        foreach ($virtualPaths as $virtualPath) {
            $normalized = $this->scope->normalize($virtualPath);
            if ($normalized !== '') {
                $pathList[$normalized] = true;
            }
        }
        if ($pathList === []) {
            return [];
        }

        /** @var array<string, array{hasPublicShare: bool, hasTeamShare: bool}> $indicators */
        $indicators = [];

        /** @var Collection<int, DriveShare> $shares */
        $shares = DriveShare::query()
            ->where('owner_username', $owner)
            ->whereNull('revoked_at')
            ->whereIn('path', array_keys($pathList))
            ->get(['id', 'path', 'kind', 'owner_username']);

        if ($shares->isEmpty()) {
            return [];
        }

        $memberShareIds = [];
        foreach ($shares as $share) {
            $path = $this->scope->normalize((string) $share->path);
            if ($share->kind === 'public') {
                $indicators[$path] ??= ['hasPublicShare' => false, 'hasTeamShare' => false];
                $indicators[$path]['hasPublicShare'] = true;

                continue;
            }
            if ($share->kind === 'member') {
                $memberShareIds[] = (string) $share->id;
            }
        }

        if ($memberShareIds !== []) {
            $sharesById = $shares->keyBy(static fn (DriveShare $share): string => (string) $share->id);
            // A grant hidden by Epic #1915 does not count, so the badge matches the access panel.
            $activeMemberShareIds = [];
            $grants = DriveShareGrant::query()
                ->whereIn('share_id', $memberShareIds)
                ->whereIn('grantee_type', ['user', 'group'])
                ->where('status', 'active')
                ->get(['id', 'share_id', 'grantee_type', 'grantee_user', 'grantee_group']);
            foreach ($grants as $grant) {
                $share = $sharesById->get((string) $grant->share_id);
                if ($share !== null && $this->grantVisibility->isVisible($grant, $share)) {
                    $activeMemberShareIds[(string) $grant->share_id] = true;
                }
            }
            foreach ($shares as $share) {
                if ($share->kind !== 'member') {
                    continue;
                }
                if (! isset($activeMemberShareIds[(string) $share->id])) {
                    continue;
                }
                $path = $this->scope->normalize((string) $share->path);
                $indicators[$path] ??= ['hasPublicShare' => false, 'hasTeamShare' => false];
                $indicators[$path]['hasTeamShare'] = true;
            }
        }

        return $indicators;
    }
}
