<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Exceptions\ApiHttpException;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Services\Settings\GroupDirectoryService;
use Illuminate\Support\Collection;

/**
 * Lists an owner's grants that match one principal, optionally scoped to a path.
 */
final class DriveShareByPrincipalQuery
{
    public function __construct(
        private DriveSharePathScope $scope,
        private DriveShareRules $rules,
        private DriveSharePresenter $presenter,
        private DriveShareScopedGrants $scopedGrants,
        private GroupDirectoryService $groupDirectory,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function byPrincipal(string $ownerUsername, string $principal, ?string $scope = null): array
    {
        $owner = strtolower(trim($ownerUsername));
        $principal = trim($principal);
        if ($principal === '') {
            throw new ApiHttpException(400, 'principal is required.', 'bad_request');
        }

        $scopePath = null;
        if ($scope !== null && trim($scope) !== '') {
            $scopePath = $this->scope->normalize($scope);
            $this->rules->assertSharePathOwnedBy($owner, $scopePath);
        }

        $principalType = $this->principalTypeForQuery($principal);

        /** @var Collection<int, DriveShare> $shares */
        $shares = DriveShare::query()
            ->where('owner_username', $owner)
            ->whereNull('revoked_at')
            ->get();

        if ($scopePath !== null) {
            $shares = $shares->filter(function (DriveShare $share) use ($scopePath): bool {
                $sharePath = $this->scope->normalize((string) $share->path);

                return $sharePath === $scopePath || $this->scope->isWithin($scopePath, $sharePath);
            });
        }

        $shareIds = array_values($shares->pluck('id')->map(static fn ($id): string => (string) $id)->all());
        if ($shareIds === []) {
            return [
                'principal' => $this->normalizedPrincipalForResponse($principal, $principalType),
                'queriedPrincipalType' => $principalType,
                'entries' => [],
            ];
        }

        $scopedGrants = $this->scopedGrants->load($shareIds);
        $queriedUserGroupSlugs = $principalType === 'user'
            ? $this->groupSlugsForUsername(strtolower($principal))
            : [];

        $entries = [];
        foreach ($scopedGrants['grants'] as $grant) {
            if (! $this->grantMatchesPrincipalQuery($grant, $principal, $principalType, $queriedUserGroupSlugs)) {
                continue;
            }

            $entry = $this->byPrincipalEntryFromGrant(
                $grant,
                $scopedGrants['sharesById'],
                $scopePath,
                $principalType,
            );
            if ($entry !== null) {
                $entries[] = $entry;
            }
        }

        usort($entries, static function (array $a, array $b): int {
            $pathCompare = strcmp((string) $a['source']['sharePath'], (string) $b['source']['sharePath']);
            if ($pathCompare !== 0) {
                return $pathCompare;
            }

            return strcmp((string) ($a['access'] ?? ''), (string) ($b['access'] ?? ''));
        });

        return [
            'principal' => $this->normalizedPrincipalForResponse($principal, $principalType),
            'queriedPrincipalType' => $principalType,
            'entries' => $entries,
        ];
    }

    public function principalTypeForQuery(string $principal): string
    {
        if (preg_match('#^groups/([a-z0-9_-]+)$#', $principal) === 1) {
            return 'group';
        }
        if (filter_var($principal, FILTER_VALIDATE_EMAIL) !== false) {
            return 'email';
        }

        return 'user';
    }

    public function normalizedPrincipalForResponse(string $principal, string $principalType): string
    {
        if ($principalType === 'email') {
            return strtolower($principal);
        }
        if ($principalType === 'user') {
            return strtolower($principal);
        }

        return $principal;
    }

    private function shareRelationshipToScope(string $sharePath, ?string $scopePath): string
    {
        if ($scopePath === null || $sharePath === $scopePath) {
            return 'direct';
        }
        if ($this->scope->isWithin($sharePath, $scopePath)) {
            return 'ancestor';
        }
        if ($this->scope->isWithin($scopePath, $sharePath)) {
            return 'descendant';
        }

        return 'direct';
    }

    /**
     * @return list<string>
     */
    private function groupSlugsForUsername(string $username): array
    {
        $slugs = [];
        foreach ($this->groupDirectory->groupsForUser($username) as $group) {
            $uri = $group['id'];
            if (str_starts_with($uri, 'principals/groups/')) {
                $slugs[] = substr($uri, strlen('principals/groups/'));
            }
        }

        return $slugs;
    }

    /**
     * @param  list<string>  $queriedUserGroupSlugs
     */
    private function grantMatchesPrincipalQuery(
        DriveShareGrant $grant,
        string $principal,
        string $principalType,
        array $queriedUserGroupSlugs,
    ): bool {
        if ($principalType === 'user') {
            if ($grant->grantee_type === 'user'
                && $grant->status === 'active'
                && $grant->grantee_user !== null
                && strcasecmp((string) $grant->grantee_user, $principal) === 0) {
                return true;
            }

            return $grant->grantee_type === 'group'
                && $grant->status === 'active'
                && $grant->grantee_group !== null
                && in_array((string) $grant->grantee_group, $queriedUserGroupSlugs, true);
        }

        if ($principalType === 'group') {
            $slug = $this->rules->parseGroupPrincipalKey($principal);
            if ($slug === null) {
                return false;
            }

            return $grant->grantee_type === 'group'
                && $grant->status === 'active'
                && strcasecmp((string) $grant->grantee_group, $slug) === 0;
        }

        $email = strtolower($principal);
        if ($grant->grantee_type === 'email'
            && $grant->status === 'pending'
            && $grant->grantee_email !== null
            && strcasecmp((string) $grant->grantee_email, $email) === 0) {
            return true;
        }

        return $grant->grantee_type === 'user'
            && $grant->status === 'active'
            && $grant->grantee_email !== null
            && strcasecmp((string) $grant->grantee_email, $email) === 0;
    }

    /**
     * @param  Collection<string|int, DriveShare>  $sharesById
     * @return array<string, mixed>|null
     */
    private function byPrincipalEntryFromGrant(
        DriveShareGrant $grant,
        Collection $sharesById,
        ?string $scopePath,
        string $queriedPrincipalType,
    ): ?array {
        $share = $sharesById->get($grant->share_id);
        if ($share === null) {
            return null;
        }

        $sharePath = $this->scope->normalize((string) $share->path);
        $referencePath = $scopePath ?? $sharePath;
        $source = $this->presenter->grantSource($share, $referencePath);

        $entryPrincipalType = match ($grant->grantee_type) {
            'user' => 'user',
            'group' => 'group',
            'email' => 'email',
            default => 'user',
        };

        $entry = [
            'access' => (string) $grant->access,
            'principalType' => $entryPrincipalType,
            'source' => $source,
            'relationship' => $this->shareRelationshipToScope($sharePath, $scopePath),
        ];

        if ($grant->grantee_type === 'email' && $grant->status === 'pending') {
            $entry['status'] = 'pending';
            $entry['removal'] = [
                'method' => 'deleteInvite',
                'shareId' => (string) $share->id,
            ];
        } else {
            $entry['status'] = 'active';
            if ($grant->grantee_type === 'user' && $grant->grantee_user !== null) {
                if ($grant->grantee_email !== null && $grant->grantee_email !== '') {
                    $entry['invitedEmail'] = (string) $grant->grantee_email;
                }
                $entry['removal'] = [
                    'method' => 'patchShareWith',
                    'shareId' => (string) $share->id,
                    'principal' => (string) $grant->grantee_user,
                ];
            } elseif ($grant->grantee_type === 'group' && $grant->grantee_group !== null) {
                $entry['removal'] = [
                    'method' => 'patchShareWith',
                    'shareId' => (string) $share->id,
                    'principal' => 'groups/'.$grant->grantee_group,
                ];
            }
        }

        if ($queriedPrincipalType === 'user'
            && $grant->grantee_type === 'group'
            && $grant->grantee_group !== null) {
            $entry['viaGroup'] = 'groups/'.$grant->grantee_group;
        }

        return $entry;
    }
}
