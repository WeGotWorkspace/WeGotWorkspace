<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShareGrant;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

final class DriveShareGrantResolver
{
    public function __construct(
        private DriveSharePathScope $scope,
        private DriveShareOwnerReach $ownerReach,
        private DriveShareGrantVisibility $visibility,
    ) {}

    /**
     * @param  list<array{
     *   shareId: string,
     *   rootPath: string,
     *   access: string,
     *   kind: string,
     *   ownerUsername: string,
     *   grantKind: string,
     *   grantId: string,
     *   granteeGroup: string|null,
     *   granteeEmail: string|null
     * }>  $candidates
     * @return array{
     *   shareId: string,
     *   rootPath: string,
     *   access: string,
     *   kind: string,
     *   ownerUsername: string,
     *   grantKind: string,
     *   grantId: string,
     *   granteeGroup: string|null,
     *   granteeEmail: string|null
     * }|null
     */
    public function resolveWinningGrant(array $candidates): ?array
    {
        $winner = null;
        foreach ($candidates as $candidate) {
            if ($winner === null) {
                $winner = $candidate;

                continue;
            }

            $currentLength = strlen($winner['rootPath']);
            $candidateLength = strlen($candidate['rootPath']);
            if ($candidateLength > $currentLength) {
                $winner = $candidate;

                continue;
            }
            if ($candidateLength < $currentLength) {
                continue;
            }

            $winnerKind = $winner['grantKind'];
            $candidateKind = $candidate['grantKind'];
            if ($winnerKind === 'group' && $candidateKind === 'user') {
                $winner = $candidate;

                continue;
            }
            if ($winnerKind === 'user' && $candidateKind === 'group') {
                continue;
            }

            $winner['access'] = DriveShareAccess::leastPermissive($winner['access'], $candidate['access']);
        }

        return $winner;
    }

    /**
     * @param  Collection<int, DriveShareGrant>  $grants
     * @return list<array{
     *   shareId: string,
     *   rootPath: string,
     *   access: string,
     *   kind: string,
     *   ownerUsername: string,
     *   grantKind: string,
     *   grantId: string,
     *   granteeGroup: string|null,
     *   granteeEmail: string|null
     * }>
     */
    public function candidatesFromScopedGrants(Collection $grants, string $requestedPath, Carbon $now): array
    {
        $candidates = [];
        foreach ($grants as $grant) {
            $grantKind = match ($grant->grantee_type) {
                'user' => 'user',
                'group' => 'group',
                'email' => 'email',
                default => null,
            };
            if ($grantKind === null) {
                continue;
            }

            $candidate = $this->candidateFromGrant($grant, $requestedPath, $now, $grantKind);
            if ($candidate !== null) {
                $candidates[] = $candidate;
            }
        }

        return $candidates;
    }

    /**
     * @param  list<string>|null  $groupSlugs
     * @return array{
     *   shareId: string,
     *   rootPath: string,
     *   access: string,
     *   kind: string,
     *   ownerUsername: string,
     *   grantKind: string,
     *   grantId: string,
     *   granteeGroup: string|null,
     *   granteeEmail: string|null
     * }|null
     */
    public function resolveMemberGrant(string $username, string $virtualPath, ?array $groupSlugs = null): ?array
    {
        $requestedPath = $this->scope->normalize($virtualPath);
        $now = Carbon::now();
        $user = strtolower(trim($username));
        $groupSlugs = $groupSlugs ?? [];

        /** @var Collection<int, DriveShareGrant> $userGrants */
        $userGrants = DriveShareGrant::query()
            ->with('share')
            ->where('grantee_type', 'user')
            ->where('grantee_user', $user)
            ->where('status', 'active')
            ->get();

        $candidates = [];
        foreach ($userGrants as $grant) {
            $candidate = $this->candidateFromGrant($grant, $requestedPath, $now, 'user');
            if ($candidate !== null) {
                $candidates[] = $candidate;
            }
        }

        if ($groupSlugs !== []) {
            /** @var Collection<int, DriveShareGrant> $groupGrants */
            $groupGrants = DriveShareGrant::query()
                ->with('share')
                ->where('grantee_type', 'group')
                ->whereIn('grantee_group', $groupSlugs)
                ->where('status', 'active')
                ->get();

            foreach ($groupGrants as $grant) {
                $candidate = $this->candidateFromGrant($grant, $requestedPath, $now, 'group');
                if ($candidate !== null) {
                    $candidates[] = $candidate;
                }
            }
        }

        return $this->resolveWinningGrant($candidates);
    }

    /**
     * Live member-grant share roots for a user (direct + via member groups),
     * as normalized virtual paths. Revoked, expired, dormant and hidden shares are skipped.
     *
     * @param  list<string>  $groupSlugs
     * @return list<string>
     */
    public function memberShareRootPaths(string $username, array $groupSlugs): array
    {
        $paths = [];
        foreach ($this->liveMemberGrants($username, $groupSlugs) as $grant) {
            $share = $grant->share;
            if ($share !== null) {
                $paths[$this->scope->normalize((string) $share->path)] = true;
            }
        }

        return array_keys($paths);
    }

    /**
     * The user's live member grants (direct + via member groups): active, on a share that is
     * not revoked, expired, trashed or dormant, and not hidden by Epic #1915.
     *
     * @param  list<string>  $groupSlugs
     * @return list<DriveShareGrant>
     */
    public function liveMemberGrants(string $username, array $groupSlugs): array
    {
        $user = strtolower(trim($username));
        $now = Carbon::now();
        $grants = DriveShareGrant::query()
            ->with('share')
            ->where('status', 'active')
            ->where(function ($query) use ($user, $groupSlugs): void {
                $query->where(fn ($q) => $q->where('grantee_type', 'user')->where('grantee_user', $user));
                if ($groupSlugs !== []) {
                    $query->orWhere(fn ($q) => $q->where('grantee_type', 'group')->whereIn('grantee_group', $groupSlugs));
                }
            })
            ->get();

        $live = [];
        foreach ($grants as $grant) {
            $share = $grant->share;
            if ($share === null || $share->revoked_at !== null || ! $this->visibility->isVisible($grant, $share)) {
                continue;
            }
            if ($share->expires_at !== null && $share->expires_at->lessThanOrEqualTo($now)) {
                continue;
            }
            if ($this->scope->isInProductTrash($this->scope->normalize((string) $share->path))) {
                continue;
            }
            if (! $this->ownerReach->ownerReachesShare($share)) {
                continue;
            }
            $live[] = $grant;
        }

        return $live;
    }

    /**
     * Null when the grant's share is revoked, expired, trashed, dormant (owner no longer
     * reaches the share path), hidden (the owner no longer shares a Team with the grantee,
     * Epic #1915) or does not cover $requestedPath.
     *
     * @return array{
     *   shareId: string,
     *   rootPath: string,
     *   access: string,
     *   kind: string,
     *   ownerUsername: string,
     *   grantKind: string,
     *   grantId: string,
     *   granteeGroup: string|null,
     *   granteeEmail: string|null
     * }|null
     */
    public function candidateFromGrant(
        DriveShareGrant $grant,
        string $requestedPath,
        Carbon $now,
        string $grantKind,
    ): ?array {
        $share = $grant->share;
        if ($share === null || $share->revoked_at !== null || ! $this->visibility->isVisible($grant, $share)) {
            return null;
        }
        if ($share->expires_at !== null && $share->expires_at->lessThanOrEqualTo($now)) {
            return null;
        }
        $sharePath = $this->scope->normalize($share->path);
        if ($this->scope->isInProductTrash($sharePath)) {
            return null;
        }
        if (! $this->scope->isWithin($sharePath, $requestedPath)) {
            return null;
        }
        if (! $this->ownerReach->ownerReachesShare($share)) {
            return null;
        }

        return [
            'shareId' => (string) $share->id,
            'rootPath' => $sharePath,
            'access' => (string) $grant->access,
            'kind' => (string) $share->kind,
            'ownerUsername' => (string) $share->owner_username,
            'grantKind' => $grantKind,
            'grantId' => (string) $grant->id,
            'granteeGroup' => $grant->grantee_group !== null && $grant->grantee_group !== ''
                ? (string) $grant->grantee_group
                : null,
            'granteeEmail' => $grant->grantee_email !== null && $grant->grantee_email !== ''
                ? (string) $grant->grantee_email
                : null,
        ];
    }
}
