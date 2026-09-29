<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Exceptions\ApiHttpException;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Models\Principal;
use App\Services\Settings\GroupDirectoryService;
use App\Storage\StoragePaths;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Owner and grantee share-dialog payload for one path.
 */
final class DriveShareAtPathQuery
{
    public function __construct(
        private StoragePaths $paths,
        private DriveSharePathScope $scope,
        private DriveShareAuthorizer $authorizer,
        private DriveShareRules $rules,
        private DriveSharePresenter $presenter,
        private DriveShareGrantResolver $grantResolver,
        private DriveShareScopedGrants $scopedGrants,
        private GroupDirectoryService $groupDirectory,
    ) {}

    /**
     * Share dialog / Docs rights for a path.
     *
     * Owners get full share-management payload. Grantees with mayView get myRights only
     * (empty share lists) so Docs can enforce view/comment/edit without an owner call.
     *
     * @param  array{username: string, role: string}  $principal
     * @return array<string, mixed>
     */
    public function atPath(array $principal, string $virtualPath): array
    {
        $username = strtolower(trim((string) ($principal['username'] ?? '')));
        $path = $this->scope->normalize($virtualPath);

        if ($this->rules->principalOwnsSharePath($username, $path)) {
            return $this->atPathForOwner($username, $path);
        }

        try {
            $rights = $this->authorizer->effectiveRights($path, $principal);
        } catch (\InvalidArgumentException) {
            throw new ApiHttpException(403, 'Cannot share this path.', 'forbidden');
        }

        if (! $rights['mayView']) {
            throw new ApiHttpException(403, 'Cannot share this path.', 'forbidden');
        }

        return [
            'path' => $path,
            'directShares' => [],
            'coveringShares' => [],
            'nestedShares' => [],
            'grantSources' => [],
            'effectiveGrants' => [],
            'memberAccess' => [],
            'publicShares' => [],
            'myRights' => $rights,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function atPathForOwner(string $owner, string $path): array
    {
        /** @var Collection<int, DriveShare> $shares */
        $shares = DriveShare::query()
            ->where('owner_username', $owner)
            ->whereNull('revoked_at')
            ->get();

        $directShares = [];
        $coveringShares = [];
        $nestedShares = [];
        $activeCoveringShareIds = [];
        $activeDirectShareIds = [];

        foreach ($shares as $share) {
            $sharePath = $this->scope->normalize((string) $share->path);
            $status = $this->presenter->shareLifecycleStatus($share);
            $entry = [
                'share' => $this->presenter->serializeShareForOwner($share),
                'relationship' => 'direct',
                'status' => $status,
            ];

            if ($sharePath === $path) {
                $entry['relationship'] = 'direct';
                $directShares[] = $entry;
                if ($status === 'active') {
                    $activeDirectShareIds[] = (string) $share->id;
                }
            } elseif ($this->scope->isWithin($sharePath, $path)) {
                $entry['relationship'] = 'ancestor';
                $coveringShares[] = $entry;
                if ($status === 'active') {
                    $activeCoveringShareIds[] = (string) $share->id;
                }
            } elseif ($this->scope->isWithin($path, $sharePath)) {
                $entry['relationship'] = 'descendant';
                $nestedShares[] = $entry;
            }
        }

        $auditShareIds = array_map(
            static fn (array $entry): string => (string) $entry['share']['id'],
            array_merge($directShares, $coveringShares, $nestedShares),
        );
        $effectiveShareIds = array_merge($activeDirectShareIds, $activeCoveringShareIds);

        $auditScopedGrants = $auditShareIds === []
            ? ['sharesById' => collect(), 'grants' => collect()]
            : $this->scopedGrants->load($auditShareIds);

        $effectiveGrantsCollection = $auditScopedGrants['grants']->filter(
            static fn (DriveShareGrant $grant): bool => in_array((string) $grant->share_id, $effectiveShareIds, true),
        );

        $groupBatch = $this->batchGroupMetadataForShareIds($effectiveGrantsCollection);
        $grantSources = $this->buildGrantSources($auditScopedGrants['sharesById'], $auditScopedGrants['grants'], $path);
        $effectiveGrants = $this->buildEffectiveGrants($auditScopedGrants['sharesById'], $effectiveGrantsCollection, $path, $groupBatch);
        $memberAccess = $this->buildMemberAccess($effectiveGrantsCollection, $path, $groupBatch);

        $publicShares = [];
        foreach (array_merge($directShares, $coveringShares, $nestedShares) as $entry) {
            /** @var array<string, mixed> $shareData */
            $shareData = $entry['share'];
            if (($shareData['kind'] ?? '') !== 'public') {
                continue;
            }
            $sharePath = $this->scope->normalize((string) $shareData['path']);
            $publicShares[] = [
                'shareId' => (string) $shareData['id'],
                'sharePath' => $sharePath,
                'defaultAccess' => (string) $shareData['defaultAccess'],
                'hasPassword' => (bool) $shareData['hasPassword'],
                'inherited' => $sharePath !== $path,
                'status' => $entry['status'],
            ];
        }

        return [
            'path' => $path,
            'directShares' => $directShares,
            'coveringShares' => $coveringShares,
            'nestedShares' => $nestedShares,
            'grantSources' => $grantSources,
            'effectiveGrants' => $effectiveGrants,
            'memberAccess' => $memberAccess,
            'publicShares' => $publicShares,
            'myRights' => DriveShareAccess::rightsFor(
                DriveShareAccess::FULL,
                true,
                ! $this->scope->isTopLevelDrive($path),
                $this->paths->isNotePath($path),
            ),
        ];
    }

    /**
     * @param  Collection<string|int, DriveShare>  $sharesById
     * @param  Collection<int, DriveShareGrant>  $grants
     * @return list<array<string, mixed>>
     */
    private function buildGrantSources(Collection $sharesById, Collection $grants, string $requestedPath): array
    {
        if ($grants->isEmpty()) {
            return [];
        }

        $entries = [];
        foreach ($grants as $grant) {
            $entry = $this->grantSourceEntryFromGrant($grant, $sharesById, $requestedPath);
            if ($entry !== null) {
                $entries[] = $entry;
            }
        }

        return $entries;
    }

    /**
     * @param  Collection<int, DriveShareGrant>  $grants
     * @return array{
     *   membersByGroupUri: array<string, list<string>>,
     *   displayNamesByGroupUri: array<string, string>
     * }
     */
    private function batchGroupMetadataForShareIds(Collection $grants): array
    {
        if ($grants->isEmpty()) {
            return ['membersByGroupUri' => [], 'displayNamesByGroupUri' => []];
        }

        $groupSlugs = [];
        foreach ($grants as $grant) {
            if ($grant->grantee_type === 'group' && $grant->status === 'active' && $grant->grantee_group !== null) {
                $groupSlugs[(string) $grant->grantee_group] = true;
            }
        }

        $groupUris = array_map(
            static fn (string $slug): string => 'principals/groups/'.$slug,
            array_keys($groupSlugs),
        );

        return [
            'membersByGroupUri' => $this->groupDirectory->memberPrincipalUrisByGroupUris($groupUris),
            'displayNamesByGroupUri' => $this->groupDirectory->displayNamesByGroupUris($groupUris),
        ];
    }

    /**
     * @param  Collection<string|int, DriveShare>  $sharesById
     * @param  Collection<int, DriveShareGrant>  $grants
     * @param  array{
     *   membersByGroupUri: array<string, list<string>>,
     *   displayNamesByGroupUri: array<string, string>
     * }  $groupBatch
     * @return list<array<string, mixed>>
     */
    private function buildEffectiveGrants(Collection $sharesById, Collection $grants, string $requestedPath, array $groupBatch): array
    {
        if ($grants->isEmpty()) {
            return [];
        }

        $now = Carbon::now();

        /** @var array<string, list<array{candidate: array<string, mixed>, grant: DriveShareGrant}>> $buckets */
        $buckets = [];
        foreach ($grants as $grant) {
            $principalKey = $this->principalKeyForGrant($grant);
            if ($principalKey === null) {
                continue;
            }

            $grantKind = match ($grant->grantee_type) {
                'user' => 'user',
                'group' => 'group',
                'email' => 'email',
                default => null,
            };
            if ($grantKind === null) {
                continue;
            }

            $candidate = $this->grantResolver->candidateFromGrant($grant, $requestedPath, $now, $grantKind);
            if ($candidate === null) {
                continue;
            }

            $buckets[$principalKey][] = ['candidate' => $candidate, 'grant' => $grant];
        }

        $displayNames = $groupBatch['displayNamesByGroupUri'];
        $membersByGroup = $groupBatch['membersByGroupUri'];

        $entries = [];
        foreach ($buckets as $principalKey => $items) {
            $candidates = array_column($items, 'candidate');
            $winner = $this->grantResolver->resolveWinningGrant($candidates);
            if ($winner === null) {
                continue;
            }

            /** @var DriveShareGrant|null $winningGrant */
            $winningGrant = null;
            foreach ($items as $item) {
                if ($item['candidate']['grantId'] === $winner['grantId']) {
                    $winningGrant = $item['grant'];
                    break;
                }
            }
            if ($winningGrant === null) {
                $winningGrant = $items[0]['grant'];
            }

            $share = $sharesById->get($winningGrant->share_id);
            if ($share === null) {
                continue;
            }

            $entry = $this->effectiveGrantEntryFromWinner(
                $principalKey,
                $winner,
                $winningGrant,
                $share,
                $requestedPath,
            );

            if (str_starts_with($principalKey, 'groups/')) {
                $groupUri = 'principals/groups/'.substr($principalKey, strlen('groups/'));
                $entry['displayName'] = $displayNames[$groupUri] ?? substr($principalKey, strlen('groups/'));
                $entry['memberCount'] = count($membersByGroup[$groupUri] ?? []);
            }

            $entries[] = $entry;
        }

        usort($entries, static fn (array $a, array $b): int => strcmp((string) $a['principal'], (string) $b['principal']));

        return $entries;
    }

    /**
     * @param  Collection<int, DriveShareGrant>  $grants
     * @param  array{
     *   membersByGroupUri: array<string, list<string>>,
     *   displayNamesByGroupUri: array<string, string>
     * }  $groupBatch
     * @return list<array<string, mixed>>
     */
    private function buildMemberAccess(Collection $grants, string $requestedPath, array $groupBatch): array
    {
        if ($grants->isEmpty()) {
            return [];
        }

        $now = Carbon::now();

        $membersByGroupUri = $groupBatch['membersByGroupUri'];

        $usernames = [];
        $groupsByUsername = [];

        foreach ($grants as $grant) {
            if ($grant->grantee_type === 'user' && $grant->status === 'active' && $grant->grantee_user !== null) {
                $usernames[(string) $grant->grantee_user] = true;
            }
        }

        foreach ($membersByGroupUri as $groupUri => $memberUris) {
            $slug = basename(str_replace('\\', '/', $groupUri));
            $groupKey = 'groups/'.$slug;
            foreach ($memberUris as $memberUri) {
                if (! str_starts_with($memberUri, 'principals/')) {
                    continue;
                }
                $username = strtolower(substr($memberUri, strlen('principals/')));
                if ($username === '' || str_contains($username, '/')) {
                    continue;
                }
                $usernames[$username] = true;
                $groupsByUsername[$username][$groupKey] = true;
            }
        }

        if ($usernames === []) {
            return [];
        }

        $usernameList = array_keys($usernames);
        $displayNamesByUsername = Principal::query()
            ->whereIn('uri', array_map(static fn (string $u): string => 'principals/'.$u, $usernameList))
            ->pluck('displayname', 'uri')
            ->mapWithKeys(static function ($displayName, string $uri): array {
                $username = substr($uri, strlen('principals/'));

                return [$username => trim((string) $displayName) !== '' ? trim((string) $displayName) : $username];
            })
            ->all();

        $entries = [];
        foreach ($usernameList as $username) {
            $userGroupSlugs = [];
            foreach (array_keys($groupsByUsername[$username] ?? []) as $groupKey) {
                $userGroupSlugs[] = substr($groupKey, strlen('groups/'));
            }

            $candidates = [];
            foreach ($grants as $grant) {
                if ($grant->grantee_type === 'user'
                    && $grant->status === 'active'
                    && strcasecmp((string) $grant->grantee_user, $username) === 0) {
                    $candidate = $this->grantResolver->candidateFromGrant($grant, $requestedPath, $now, 'user');
                    if ($candidate !== null) {
                        $candidates[] = $candidate;
                    }
                } elseif ($grant->grantee_type === 'group'
                    && $grant->status === 'active'
                    && $grant->grantee_group !== null
                    && in_array((string) $grant->grantee_group, $userGroupSlugs, true)) {
                    $candidate = $this->grantResolver->candidateFromGrant($grant, $requestedPath, $now, 'group');
                    if ($candidate !== null) {
                        $candidates[] = $candidate;
                    }
                }
            }

            $winner = $this->grantResolver->resolveWinningGrant($candidates);
            if ($winner === null) {
                continue;
            }

            $sharePath = $winner['rootPath'];
            $viaGroup = $winner['grantKind'] === 'group' && $winner['granteeGroup'] !== null
                ? 'groups/'.$winner['granteeGroup']
                : null;
            $editable = $winner['grantKind'] === 'user';

            $winningShare = null;
            foreach ($grants as $grant) {
                if ((string) $grant->share_id === $winner['shareId'] && $grant->share !== null) {
                    $winningShare = $grant->share;
                    break;
                }
            }
            if ($winningShare === null) {
                continue;
            }

            $entry = [
                'username' => $username,
                'displayName' => $displayNamesByUsername[$username] ?? $username,
                'access' => $winner['access'],
                'viaGroup' => $viaGroup,
                'editable' => $editable,
                'source' => $this->presenter->grantSource($winningShare, $requestedPath),
                'removal' => $this->removalHintForWinner($winner, $username),
            ];

            if (! $editable) {
                $entry['editConstraint'] = 'groupOnly';
                $entry['editHint'] = 'Change the group grant or remove this member from the group.';
            }

            $entries[] = $entry;
        }

        usort($entries, static fn (array $a, array $b): int => strcmp((string) $a['username'], (string) $b['username']));

        return $entries;
    }

    private function principalKeyForGrant(DriveShareGrant $grant): ?string
    {
        if ($grant->grantee_type === 'user' && $grant->status === 'active' && $grant->grantee_user !== null) {
            return (string) $grant->grantee_user;
        }
        if ($grant->grantee_type === 'group' && $grant->status === 'active' && $grant->grantee_group !== null) {
            return 'groups/'.$grant->grantee_group;
        }
        if ($grant->grantee_type === 'email' && $grant->status === 'pending' && $grant->grantee_email !== null) {
            return (string) $grant->grantee_email;
        }

        return null;
    }

    /**
     * @param  Collection<int, DriveShare>  $sharesById
     * @return array<string, mixed>|null
     */
    private function grantSourceEntryFromGrant(
        DriveShareGrant $grant,
        Collection $sharesById,
        string $requestedPath,
    ): ?array {
        $share = $sharesById->get($grant->share_id);
        if ($share === null) {
            return null;
        }

        $source = $this->presenter->grantSource($share, $requestedPath);

        if ($grant->grantee_type === 'user' && $grant->status === 'active' && $grant->grantee_user !== null) {
            return [
                'principal' => (string) $grant->grantee_user,
                'principalType' => 'user',
                'access' => (string) $grant->access,
                'source' => $source,
            ];
        }

        if ($grant->grantee_type === 'group' && $grant->status === 'active' && $grant->grantee_group !== null) {
            return [
                'principal' => 'groups/'.$grant->grantee_group,
                'principalType' => 'group',
                'access' => (string) $grant->access,
                'source' => $source,
            ];
        }

        if ($grant->grantee_type === 'email' && $grant->status === 'pending' && $grant->grantee_email !== null) {
            return [
                'principal' => (string) $grant->grantee_email,
                'principalType' => 'email',
                'access' => (string) $grant->access,
                'status' => 'pending',
                'source' => $source,
            ];
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $winner
     * @return array<string, mixed>
     */
    private function effectiveGrantEntryFromWinner(
        string $principalKey,
        array $winner,
        DriveShareGrant $grant,
        DriveShare $share,
        string $requestedPath,
    ): array {
        $source = $this->presenter->grantSource($share, $requestedPath);
        $principalType = match ($grant->grantee_type) {
            'user' => 'user',
            'group' => 'group',
            'email' => 'email',
            default => 'user',
        };

        $entry = [
            'principal' => $principalKey,
            'principalType' => $principalType,
            'access' => $winner['access'],
            'source' => $source,
        ];

        if ($grant->grantee_type === 'email' && $grant->status === 'pending') {
            $entry['status'] = 'pending';
            $entry['inviteId'] = (string) $grant->id;
            $entry['removal'] = [
                'method' => 'deleteInvite',
                'shareId' => $winner['shareId'],
            ];
        } elseif ($grant->grantee_type === 'user') {
            if ($grant->grantee_email !== null && $grant->grantee_email !== '') {
                $entry['invitedEmail'] = (string) $grant->grantee_email;
            }
            $entry['removal'] = [
                'method' => 'patchShareWith',
                'shareId' => $winner['shareId'],
                'principal' => $principalKey,
            ];
        } elseif ($grant->grantee_type === 'group') {
            $entry['removal'] = [
                'method' => 'patchShareWith',
                'shareId' => $winner['shareId'],
                'principal' => $principalKey,
            ];
        }

        return $entry;
    }

    /**
     * @param  array<string, mixed>  $winner
     * @return array<string, mixed>
     */
    private function removalHintForWinner(array $winner, string $username): array
    {
        if ($winner['grantKind'] === 'group' && $winner['granteeGroup'] !== null) {
            return [
                'method' => 'patchShareWith',
                'shareId' => $winner['shareId'],
                'principal' => 'groups/'.$winner['granteeGroup'],
            ];
        }

        return [
            'method' => 'patchShareWith',
            'shareId' => $winner['shareId'],
            'principal' => $username,
        ];
    }
}
