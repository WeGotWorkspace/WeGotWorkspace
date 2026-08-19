<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Exceptions\ApiHttpException;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Models\DriveShareSession;
use App\Models\Principal;
use App\Services\Auth\JwtTokenService;
use App\Services\Notes\NoteMarkdownCodec;
use App\Services\Settings\GroupDirectoryService;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

final class DriveShareService
{
    private const GUEST_JWT_TTL_SECONDS = 3600;

    public function __construct(
        private StoragePaths $paths,
        private DriveSharePathScope $scope,
        private DriveGroupResolver $groups,
        private DriveShareGrantResolver $grantResolver,
        private GroupDirectoryService $groupDirectory,
        private WgwStorage $storage,
        private JwtTokenService $jwtTokens,
        private DriveShareSessionRateLimiter $rateLimiter,
        private CollabDocFormats $collabDocFormats,
        private DriveShareAuthorizer $authorizer,
        private NoteMarkdownCodec $noteCodec,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function listForOwner(string $username, ?string $path): array
    {
        $query = DriveShare::query()
            ->where('owner_username', strtolower($username))
            ->whereNull('revoked_at')
            ->orderByDesc('updated_at');

        if ($path !== null && trim($path) !== '') {
            $normalized = $this->scope->normalize($path);
            $query->where('path', $normalized);
        }

        /** @var Collection<int, DriveShare> $shares */
        $shares = $query->get();

        return $shares->map(fn (DriveShare $share): array => $this->serializeShareForOwner($share))->values()->all();
    }

    /**
     * Rewrite share rows whose path equals or is nested under $fromPath so they
     * follow a rename/move to $toPath (directory prefix rewrite).
     *
     * Grants stay on share_id; only drive_shares.path is updated.
     *
     * @return int number of share rows rewritten
     */
    public function rewritePathPrefix(string $fromPath, string $toPath): int
    {
        $from = $this->scope->normalize($fromPath);
        $to = $this->scope->normalize($toPath);
        if ($from === '' || $from === '/' || $from === $to) {
            return 0;
        }

        return (int) DB::connection('wgw')->transaction(function () use ($from, $to): int {
            // LIKE is a coarse filter (_ / % are wildcards); str_starts_with is authoritative.
            /** @var Collection<int, DriveShare> $shares */
            $shares = DriveShare::query()
                ->where(function ($query) use ($from): void {
                    $query->where('path', $from)
                        ->orWhere('path', 'like', $from.'/%');
                })
                ->lockForUpdate()
                ->get();

            $count = 0;
            $now = Carbon::now();
            foreach ($shares as $share) {
                $old = $this->scope->normalize((string) $share->path);
                if ($old !== $from && ! str_starts_with($old, $from.'/')) {
                    continue;
                }
                $share->path = $old === $from ? $to : $to.substr($old, strlen($from));
                $share->timestamps = false;
                $share->updated_at = $now;
                $share->save();
                $share->timestamps = true;
                $count++;
            }

            return $count;
        });
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function createShare(string $username, array $input): array
    {
        $owner = strtolower(trim($username));
        $path = $this->requiredPath($input['path'] ?? null);
        $kind = $this->normalizeKind($input['kind'] ?? 'member');
        $rawDefaultAccess = strtolower(trim((string) ($input['defaultAccess'] ?? DriveShareAccess::VIEW)));
        $this->assertSharePathOwnedBy($owner, $path);
        $this->assertSharePathNotTopLevelDrive($path);
        $this->assertNotePathShareCreate($path, $kind, $rawDefaultAccess);
        $defaultAccess = $this->normalizeAccess($rawDefaultAccess);
        $expiresAt = $this->parseOptionalDate($input['expiresAt'] ?? null);
        $password = $this->normalizeNullableString($input['password'] ?? null);
        /** @var array<string, mixed>|null $shareWith */
        $shareWith = is_array($input['shareWith'] ?? null) ? $input['shareWith'] : null;

        if (! $this->paths->isNotePath($path)) {
            $this->assertCommentReviewApplicable($path, $defaultAccess);
        }
        $this->assertPublicAccessCap($kind, $defaultAccess);

        $publicToken = $kind === 'public' ? $this->generatePublicToken() : null;

        return DB::connection('wgw')->transaction(function () use (
            $owner,
            $path,
            $kind,
            $defaultAccess,
            $expiresAt,
            $password,
            $publicToken,
            $shareWith
        ): array {
            $share = new DriveShare;
            $share->id = (string) Str::uuid();
            $share->path = $path;
            $share->owner_username = $owner;
            $share->kind = $kind;
            $share->default_access = $defaultAccess;
            $share->public_token = $publicToken;
            $share->password_hash = $password !== null ? Hash::make($password) : null;
            $share->expires_at = $expiresAt;
            $share->revoked_at = null;
            $share->save();

            if ($shareWith !== null) {
                $this->mergeShareWith($share, $shareWith);
            }

            $share->refresh();

            return $this->serializeShareForOwner($share);
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function getShareForOwner(string $username, string $shareId): array
    {
        $share = $this->ownerShareOrFail($username, $shareId);

        return $this->serializeShareForOwner($share);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function updateShare(string $username, string $shareId, array $input): array
    {
        return DB::connection('wgw')->transaction(function () use ($username, $shareId, $input): array {
            $share = $this->ownerShareOrFail($username, $shareId, lockForUpdate: true);
            $this->assertUpdatedAtMatches($share, $input['updatedAt'] ?? null);

            if (array_key_exists('defaultAccess', $input)) {
                $rawAccess = strtolower(trim((string) $input['defaultAccess']));
                if ($this->paths->isNotePath((string) $share->path)) {
                    $this->assertNotePathAccessAllowed($rawAccess);
                }
                $share->default_access = $this->normalizeAccess($rawAccess);
                if (! $this->paths->isNotePath((string) $share->path)) {
                    $this->assertCommentReviewApplicable($share->path, $share->default_access);
                }
                $this->assertPublicAccessCap((string) $share->kind, $share->default_access);
            }
            if (array_key_exists('expiresAt', $input)) {
                $share->expires_at = $this->parseOptionalDate($input['expiresAt']);
            }
            if (array_key_exists('password', $input)) {
                $password = $this->normalizeNullableString($input['password']);
                $share->password_hash = $password !== null ? Hash::make($password) : null;

                DriveShareSession::query()
                    ->where('share_id', $share->id)
                    ->whereNull('revoked_at')
                    ->update(['revoked_at' => Carbon::now()]);
            }
            $share->timestamps = false;
            $share->updated_at = $this->nextUpdatedAt($share);
            $share->save();
            $share->timestamps = true;

            if (is_array($input['shareWith'] ?? null)) {
                /** @var array<string, mixed> $shareWith */
                $shareWith = $input['shareWith'];
                $this->mergeShareWith($share, $shareWith);
            }

            $share->refresh();

            return $this->serializeShareForOwner($share);
        });
    }

    public function revokeShare(string $username, string $shareId): void
    {
        DB::connection('wgw')->transaction(function () use ($username, $shareId): void {
            $share = $this->ownerShareOrFail($username, $shareId, lockForUpdate: true);
            $this->revokeShareRecord($share);
        });
    }

    /**
     * @return array{revokedCount: int, shareIds: list<string>}
     */
    public function revokeAllPublicUnderPath(string $username, string $virtualPath): array
    {
        $owner = strtolower(trim($username));
        $path = $this->scope->normalize($virtualPath);
        $this->assertSharePathOwnedBy($owner, $path);

        return DB::connection('wgw')->transaction(function () use ($owner, $path): array {
            /** @var Collection<int, DriveShare> $shares */
            $shares = DriveShare::query()
                ->where('owner_username', $owner)
                ->where('kind', 'public')
                ->whereNull('revoked_at')
                ->lockForUpdate()
                ->get();

            $revokedIds = [];
            foreach ($shares as $share) {
                $sharePath = $this->scope->normalize((string) $share->path);
                if ($sharePath !== $path && ! $this->scope->isWithin($path, $sharePath)) {
                    continue;
                }

                $this->revokeShareRecord($share);
                $revokedIds[] = (string) $share->id;
            }

            return [
                'revokedCount' => count($revokedIds),
                'shareIds' => $revokedIds,
            ];
        });
    }

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
            $this->assertSharePathOwnedBy($owner, $scopePath);
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

        $shareIds = $shares->pluck('id')->map(static fn ($id): string => (string) $id)->values()->all();
        if ($shareIds === []) {
            return [
                'principal' => $this->normalizedPrincipalForResponse($principal, $principalType),
                'queriedPrincipalType' => $principalType,
                'entries' => [],
            ];
        }

        $scopedGrants = $this->loadScopedGrants($shareIds);
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

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function createInvite(string $username, string $shareId, array $input): array
    {
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new ApiHttpException(400, 'Valid email is required.', 'bad_request');
        }
        $access = $this->normalizeAccess((string) ($input['access'] ?? ''));

        return DB::connection('wgw')->transaction(function () use ($username, $shareId, $email, $access): array {
            $share = $this->ownerShareOrFail($username, $shareId, lockForUpdate: true);
            if ($this->paths->isNotePath((string) $share->path)) {
                throw new ApiHttpException(400, 'Email invites are not supported for note paths.', 'bad_request');
            }
            $this->assertCommentReviewApplicable($share->path, $access);

            $grant = $this->upsertEmailInviteGrant($share, $email, $access);

            return [
                'id' => (string) $grant->id,
                'email' => $email,
                'access' => $access,
                'inviteToken' => (string) $grant->invite_token,
            ];
        });
    }

    public function revokeInvite(string $username, string $shareId, string $inviteId): void
    {
        DB::connection('wgw')->transaction(function () use ($username, $shareId, $inviteId): void {
            $share = $this->ownerShareOrFail($username, $shareId, lockForUpdate: true);

            /** @var DriveShareGrant|null $grant */
            $grant = DriveShareGrant::query()
                ->where('id', $inviteId)
                ->where('share_id', $share->id)
                ->where('grantee_type', 'email')
                ->where('status', 'pending')
                ->lockForUpdate()
                ->first();

            if ($grant === null) {
                throw new ApiHttpException(404, 'Invite not found.', 'not_found');
            }

            $grant->status = 'revoked';
            $grant->save();
        });
    }

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

        if ($this->principalOwnsSharePath($username, $path)) {
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
            $status = $this->shareLifecycleStatus($share);
            $entry = [
                'share' => $this->serializeShareForOwner($share),
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
            : $this->loadScopedGrants($auditShareIds);

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
     * Path-keyed member grants. Note paths are omitted unless `$includeNotes`.
     *
     * @return list<array<string, mixed>>
     */
    public function sharedWithMe(string $username, bool $includeNotes = false): array
    {
        $rows = [];
        foreach ($this->memberGrantRows($username) as $row) {
            $path = (string) ($row['share']['path'] ?? '');
            if (! $includeNotes && $this->paths->isNotePath($path)) {
                continue;
            }
            $rows[] = $row;
        }

        return $rows;
    }

    /**
     * Note-file grants shared with the current user (`.md` under `.notes`).
     *
     * @return list<array<string, mixed>>
     */
    public function notesSharedWithMe(string $username): array
    {
        $items = [];
        foreach ($this->memberGrantRows($username) as $row) {
            $path = (string) ($row['share']['path'] ?? '');
            if (! $this->paths->isNotePath($path)) {
                continue;
            }
            $meta = $this->noteListingMetaFromPath($path);
            if ($meta === null || ($meta['kind'] ?? '') !== 'note') {
                continue;
            }
            // Prefer live entry type when present; path meta is enough for note files
            // (listing must not depend on directoryEntry succeeding).
            $entry = $row['entry'] ?? null;
            if (is_array($entry) && ($entry['type'] ?? '') === 'dir') {
                continue;
            }
            // Skip grants whose file was archived/deleted — avoids ghost Shared-with-me rows.
            $storageKey = $this->paths->virtualToStorageKey($path);
            if (! $this->filesDisk()->fileExists($storageKey)) {
                continue;
            }
            $listFields = $this->noteListFieldsFromPath($path, (string) $meta['id']);
            $item = [
                'path' => $path,
                'id' => $meta['id'],
                'notebook' => $meta['notebook'],
                'title' => $listFields['title'],
                'tags' => $listFields['tags'],
                'owner' => $meta['owner'],
                'scope' => $meta['scope'],
                'groupSlug' => $meta['groupSlug'],
                'access' => (string) ($row['share']['defaultAccess'] ?? DriveShareAccess::VIEW),
                'myRights' => $row['share']['myRights'] ?? DriveShareAccess::rightsFor(
                    (string) ($row['share']['defaultAccess'] ?? DriveShareAccess::VIEW),
                    true,
                    false,
                    true,
                ),
            ];
            if (isset($row['viaGroup'])) {
                $item['viaGroup'] = $row['viaGroup'];
            }
            $items[] = $item;
        }

        return $items;
    }

    /**
     * Personal notebook-directory ACL shares are not a product feature.
     *
     * Group membership notebooks are listed via Notes notebooks/items (not path
     * grants). This endpoint remains for contract compatibility and always
     * returns an empty list.
     *
     * @return list<array<string, mixed>>
     */
    public function notesSharedNotebooks(string $username): array
    {
        unset($username);

        return [];
    }

    /**
     * Notes under personal ACL-shared notebook directories — removed; always empty.
     * Group-membership notebook notes come from GET /notes/items instead.
     *
     * @param  list<array<string, mixed>>|null  $notebooks  Ignored (compat).
     * @return list<array<string, mixed>>
     */
    public function notesUnderSharedNotebooks(string $username, ?array $notebooks = null): array
    {
        unset($username, $notebooks);

        return [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function memberGrantRows(string $username): array
    {
        $user = strtolower(trim($username));
        $groupSlugs = $this->groups->allowedGroupSlugs($user);
        $now = Carbon::now();

        /** @var Collection<int, DriveShareGrant> $userGrants */
        $userGrants = DriveShareGrant::query()
            ->with('share')
            ->where('grantee_type', 'user')
            ->where('grantee_user', $user)
            ->where('status', 'active')
            ->get();

        /** @var Collection<int, DriveShareGrant> $groupGrants */
        $groupGrants = $groupSlugs === []
            ? collect()
            : DriveShareGrant::query()
                ->with('share')
                ->where('grantee_type', 'group')
                ->whereIn('grantee_group', $groupSlugs)
                ->where('status', 'active')
                ->get();

        $directByShareId = [];
        foreach ($userGrants as $grant) {
            $share = $grant->share;
            if ($share === null || ! $this->isShareLive($share, $now)) {
                continue;
            }
            $directByShareId[(string) $share->id] = $grant;
        }

        $rows = [];
        foreach ($directByShareId as $grant) {
            $share = $grant->share;
            if ($share === null) {
                continue;
            }
            $access = (string) $grant->access;
            $row = [
                'share' => $this->serializeShareForMember($share, $access),
            ];
            $entry = $this->directoryEntryForSharePath((string) $share->path, $access);
            if ($entry !== null) {
                $row['entry'] = $entry;
            }
            $rows[] = $row;
        }

        foreach ($groupGrants as $grant) {
            $share = $grant->share;
            if ($share === null || ! $this->isShareLive($share, $now)) {
                continue;
            }
            $shareId = (string) $share->id;
            if (isset($directByShareId[$shareId])) {
                continue;
            }
            $slug = (string) $grant->grantee_group;
            $access = (string) $grant->access;
            $row = [
                'share' => $this->serializeShareForMember($share, $access),
                'viaGroup' => 'groups/'.$slug,
            ];
            $entry = $this->directoryEntryForSharePath((string) $share->path, $access);
            if ($entry !== null) {
                $row['entry'] = $entry;
            }
            $rows[] = $row;
        }

        return $rows;
    }

    /**
     * @return array{
     *   access_token: string,
     *   token_type: string,
     *   expires_in: int,
     *   role: string,
     *   username: string,
     *   share: array<string, mixed>
     * }
     */
    public function createSessionFromPublicToken(string $token, ?string $password, string $ip): array
    {
        $token = strtolower(trim($token));
        if ($token === '') {
            throw new ApiHttpException(400, 'token is required.', 'bad_request');
        }
        if (! $this->rateLimiter->allow($ip, $token)) {
            throw new ApiHttpException(429, 'Too many attempts. Please try again later.', 'throttled');
        }

        $share = DriveShare::query()
            ->where('public_token', $token)
            ->first();

        if ($share === null) {
            throw new ApiHttpException(404, 'This share link is invalid or has expired.', 'share_unavailable');
        }

        if ($share->revoked_at !== null || $share->kind !== 'public') {
            throw new ApiHttpException(410, 'This share link is no longer available.', 'share_unavailable');
        }

        if ($share->expires_at !== null && $share->expires_at->lessThanOrEqualTo(Carbon::now())) {
            throw new ApiHttpException(410, 'This share link has expired.', 'share_unavailable');
        }

        if ($share->password_hash !== null && $share->password_hash !== '') {
            $submittedPassword = $password ?? '';
            if ($submittedPassword === '') {
                throw new ApiHttpException(401, 'Password is required to open this link.', 'share_password_required');
            }
            if (! Hash::check($submittedPassword, $share->password_hash)) {
                throw new ApiHttpException(401, 'Incorrect password.', 'share_password_invalid');
            }
        }

        // v1 intentionally couples JWT TTL and DB session lifetime (both 1h) — no refresh flow yet.
        $now = Carbon::now();
        $sessionExpiresAt = $now->copy()->addSeconds(self::GUEST_JWT_TTL_SECONDS);
        if ($share->expires_at !== null && $share->expires_at->lessThan($sessionExpiresAt)) {
            $sessionExpiresAt = $share->expires_at->copy();
        }

        $session = new DriveShareSession;
        $session->id = (string) Str::uuid();
        $session->share_id = (string) $share->id;
        $session->session_key = bin2hex(random_bytes(16));
        $session->expires_at = $sessionExpiresAt;
        $session->revoked_at = null;
        $session->save();

        $exp = min($sessionExpiresAt->timestamp, $now->timestamp + self::GUEST_JWT_TTL_SECONDS);
        $sessionSubject = 'share:'.$session->session_key;
        $jwt = $this->jwtTokens->issue([
            'sub' => $sessionSubject,
            'role' => 'guest',
            'exp' => $exp,
        ]);

        return [
            'access_token' => $jwt,
            'token_type' => 'Bearer',
            'expires_in' => max(1, $exp - $now->timestamp),
            'role' => 'guest',
            'username' => $sessionSubject,
            'share' => [
                'id' => (string) $share->id,
                'path' => (string) $share->path,
                'defaultAccess' => (string) $share->default_access,
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function acceptInvite(string $username, string $inviteToken): array
    {
        $inviteToken = trim($inviteToken);
        if ($inviteToken === '') {
            throw new ApiHttpException(400, 'inviteToken is required.', 'bad_request');
        }

        return DB::connection('wgw')->transaction(function () use ($username, $inviteToken): array {
            /** @var DriveShareGrant|null $grant */
            $grant = DriveShareGrant::query()
                ->with('share')
                ->where('invite_token', $inviteToken)
                ->where('grantee_type', 'email')
                ->where('status', 'pending')
                ->lockForUpdate()
                ->first();

            if ($grant === null || $grant->share === null || $grant->share->revoked_at !== null) {
                throw new ApiHttpException(404, 'Invite not found.', 'not_found');
            }

            $grant->grantee_type = 'user';
            $grant->grantee_user = strtolower($username);
            $grant->status = 'active';
            $grant->invite_token = null;
            $grant->save();

            return ['shareId' => (string) $grant->share_id, 'accepted' => true];
        });
    }

    private function requiredPath(mixed $value): string
    {
        if (! is_string($value) || trim($value) === '') {
            throw new ApiHttpException(400, 'path is required.', 'bad_request');
        }

        return $this->scope->normalize($value);
    }

    private function normalizeKind(mixed $value): string
    {
        $kind = strtolower(trim((string) $value));
        if (! in_array($kind, ['public', 'member', 'guest'], true)) {
            throw new ApiHttpException(400, 'Invalid kind.', 'bad_request');
        }

        return $kind;
    }

    private function normalizeAccess(string $access): string
    {
        $normalized = DriveShareAccess::normalize($access);
        if (! DriveShareAccess::isValid($normalized)) {
            throw new ApiHttpException(400, 'Invalid access.', 'bad_request');
        }

        return $normalized;
    }

    private function parseOptionalDate(mixed $value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_string($value)) {
            throw new ApiHttpException(400, 'Invalid expiresAt.', 'bad_request');
        }

        try {
            return Carbon::parse($value);
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Invalid expiresAt.', 'bad_request');
        }
    }

    private function normalizeNullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            throw new ApiHttpException(400, 'Invalid string value.', 'bad_request');
        }
        $trimmed = trim($value);

        return $trimmed !== '' ? $trimmed : null;
    }

    private function principalOwnsSharePath(string $username, string $path): bool
    {
        $segments = explode('/', ltrim($path, '/'));
        $root = (string) ($segments[0] ?? '');
        if ($root === 'users' && strcasecmp((string) ($segments[1] ?? ''), $username) === 0) {
            return true;
        }
        if ($root === 'groups') {
            $group = (string) ($segments[1] ?? '');
            if ($group !== '' && in_array($group, $this->groups->allowedGroupSlugs($username), true)) {
                return true;
            }
        }

        return false;
    }

    private function assertSharePathOwnedBy(string $username, string $path): void
    {
        if ($this->principalOwnsSharePath($username, $path)) {
            return;
        }

        throw new ApiHttpException(403, 'Cannot share this path.', 'forbidden');
    }

    private function assertSharePathNotTopLevelDrive(string $path): void
    {
        if ($this->scope->isTopLevelDrive($path)) {
            throw new ApiHttpException(403, 'Cannot share this path.', 'forbidden');
        }
    }

    private function assertCommentReviewApplicable(string $path, string $access): void
    {
        if ($access !== DriveShareAccess::COMMENT) {
            return;
        }

        $disk = $this->filesDisk();
        $key = $this->paths->virtualToStorageKey($path);
        if ($disk->fileExists($key) && ! $this->collabDocFormats->isCollabDocPath($path)) {
            throw new ApiHttpException(400, 'Access level is not applicable for this target.', 'comment_not_applicable');
        }
    }

    /**
     * Note paths only accept member shares with view|edit (reject comment/review/full before normalize).
     */
    private function assertNotePathShareCreate(string $path, string $kind, string $rawAccess): void
    {
        if (! $this->paths->isNotePath($path)) {
            return;
        }

        if ($kind !== 'member') {
            throw new ApiHttpException(400, 'Note paths only support member shares.', 'bad_request');
        }

        $this->assertNotePathShareTarget($path);
        $this->assertNotePathAccessAllowed($rawAccess);
    }

    private function assertNotePathAccessAllowed(string $rawAccess): void
    {
        $access = strtolower(trim($rawAccess));
        if (
            $access === DriveShareAccess::COMMENT
            || $access === DriveShareAccess::REVIEW
            || $access === DriveShareAccess::FULL
        ) {
            throw new ApiHttpException(400, 'Access level is not applicable for note paths.', 'comment_not_applicable');
        }
        if (! in_array($access, [DriveShareAccess::VIEW, DriveShareAccess::EDIT], true)) {
            throw new ApiHttpException(400, 'Invalid access.', 'bad_request');
        }
    }

    private function assertNotePathShareTarget(string $path): void
    {
        // Notes sharing is file-level only (…/.notes/{notebook}/{id}.md).
        // Personal notebook-directory grants are rejected (product non-goal).
        if (preg_match('#^/(?:users|groups)/[^/]+/\.notes/[^/]+/[^/]+\.md$#i', $path) === 1) {
            return;
        }

        $meta = $this->noteListingMetaFromPath($path);
        if ($meta !== null && ($meta['kind'] ?? '') === 'notebook') {
            throw new ApiHttpException(
                400,
                'Notebook directories cannot be shared; share individual notes instead.',
                'bad_request',
            );
        }

        throw new ApiHttpException(400, 'Invalid note share path.', 'bad_request');
    }

    /**
     * @param  array<string, mixed>  $shareWith
     */
    private function mergeShareWith(DriveShare $share, array $shareWith): void
    {
        $isNotePath = $this->paths->isNotePath((string) $share->path);

        foreach ($shareWith as $principalId => $grantValue) {
            $principalId = trim((string) $principalId);
            if ($principalId === '') {
                throw new ApiHttpException(400, 'shareWith principal id must not be empty.', 'bad_request');
            }

            $isEmail = filter_var($principalId, FILTER_VALIDATE_EMAIL) !== false;
            $groupSlug = $this->parseGroupPrincipalKey($principalId);

            if ($grantValue === null) {
                if ($isEmail) {
                    DriveShareGrant::query()
                        ->where('share_id', $share->id)
                        ->where('grantee_type', 'email')
                        ->where('grantee_email', strtolower($principalId))
                        ->delete();
                } elseif ($groupSlug !== null) {
                    DriveShareGrant::query()
                        ->where('share_id', $share->id)
                        ->where('grantee_type', 'group')
                        ->where('grantee_group', $groupSlug)
                        ->delete();
                } else {
                    DriveShareGrant::query()
                        ->where('share_id', $share->id)
                        ->where('grantee_type', 'user')
                        ->where('grantee_user', strtolower($principalId))
                        ->delete();
                }

                continue;
            }
            if (! is_array($grantValue)) {
                throw new ApiHttpException(400, 'shareWith grant must be an object or null.', 'bad_request');
            }

            if ($isNotePath && $isEmail) {
                throw new ApiHttpException(400, 'Email invites are not supported for note paths.', 'bad_request');
            }

            $rawAccess = strtolower(trim((string) ($grantValue['access'] ?? '')));
            if ($isNotePath) {
                $this->assertNotePathAccessAllowed($rawAccess);
            }
            $access = $this->normalizeAccess($rawAccess);
            if (! $isNotePath) {
                $this->assertCommentReviewApplicable($share->path, $access);
            }

            if ($isEmail) {
                $this->upsertEmailGrant($share, strtolower($principalId), $access);

                continue;
            }

            if ($groupSlug !== null) {
                $this->assertGroupExists($groupSlug);
                $this->upsertGroupGrant($share, $groupSlug, $access);

                continue;
            }

            /** @var DriveShareGrant|null $grant */
            $grant = DriveShareGrant::query()
                ->where('share_id', $share->id)
                ->where('grantee_type', 'user')
                ->where('grantee_user', strtolower($principalId))
                ->first();

            if ($grant === null) {
                $grant = new DriveShareGrant;
                $grant->id = (string) Str::uuid();
                $grant->share_id = (string) $share->id;
                $grant->grantee_type = 'user';
                $grant->grantee_user = strtolower($principalId);
            }

            $grant->access = $access;
            $grant->status = 'active';
            $grant->save();
        }
    }

    private function upsertGroupGrant(DriveShare $share, string $slug, string $access): void
    {
        /** @var DriveShareGrant|null $grant */
        $grant = DriveShareGrant::query()
            ->where('share_id', $share->id)
            ->where('grantee_type', 'group')
            ->where('grantee_group', $slug)
            ->first();

        if ($grant === null) {
            $grant = new DriveShareGrant;
            $grant->id = (string) Str::uuid();
            $grant->share_id = (string) $share->id;
            $grant->grantee_type = 'group';
            $grant->grantee_group = $slug;
        }

        $grant->access = $access;
        $grant->status = 'active';
        $grant->save();
    }

    private function upsertEmailGrant(DriveShare $share, string $email, string $access): void
    {
        $this->upsertEmailInviteGrant($share, $email, $access);
    }

    private function upsertEmailInviteGrant(DriveShare $share, string $email, string $access): DriveShareGrant
    {
        /** @var DriveShareGrant|null $grant */
        $grant = DriveShareGrant::query()
            ->where('share_id', $share->id)
            ->where('grantee_email', $email)
            ->lockForUpdate()
            ->first();

        if ($grant !== null && $grant->status === 'active') {
            throw new ApiHttpException(409, 'Guest already has access.', 'share_conflict');
        }

        if ($grant === null) {
            $grant = new DriveShareGrant;
            $grant->id = (string) Str::uuid();
            $grant->share_id = (string) $share->id;
            $grant->grantee_type = 'email';
            $grant->grantee_email = $email;
            $grant->status = 'pending';
            $grant->invite_token = bin2hex(random_bytes(16));
        } elseif ($grant->status === 'revoked') {
            $grant->grantee_type = 'email';
            $grant->grantee_user = null;
            $grant->status = 'pending';
            $grant->invite_token = bin2hex(random_bytes(16));
        }

        $grant->access = $access;
        $grant->save();

        return $grant;
    }

    private function assertUpdatedAtMatches(DriveShare $share, mixed $updatedAt): void
    {
        if (! is_string($updatedAt) || trim($updatedAt) === '') {
            throw new ApiHttpException(400, 'updatedAt is required.', 'bad_request');
        }
        try {
            $provided = Carbon::parse($updatedAt);
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Invalid updatedAt.', 'bad_request');
        }
        $current = $share->updated_at;
        if (! $current instanceof Carbon) {
            throw new ApiHttpException(409, 'Share update conflict.', 'share_conflict');
        }
        if (! $current->equalTo($provided)) {
            throw new ApiHttpException(409, 'Share update conflict.', 'share_conflict');
        }
    }

    private function nextUpdatedAt(DriveShare $share): Carbon
    {
        $now = Carbon::now();
        $current = $share->updated_at;
        if ($current instanceof Carbon && $now->timestamp <= $current->timestamp) {
            $now = $current->copy()->addSecond();
        }

        return $now;
    }

    private function ownerShareOrFail(string $username, string $shareId, bool $lockForUpdate = false): DriveShare
    {
        $query = DriveShare::query()
            ->where('id', $shareId)
            ->where('owner_username', strtolower($username))
            ->whereNull('revoked_at');

        if ($lockForUpdate) {
            $query->lockForUpdate();
        }

        /** @var DriveShare|null $share */
        $share = $query->first();
        if ($share === null) {
            throw new ApiHttpException(404, 'Share not found.', 'not_found');
        }

        return $share;
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeShareForOwner(DriveShare $share): array
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
    private function serializeShareForMember(DriveShare $share, string $grantAccess): array
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
    private function directoryEntryForSharePath(string $virtualPath, string $grantAccess): ?array
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

    /**
     * @return array{
     *   kind: 'note'|'notebook',
     *   owner: string,
     *   scope: 'personal'|'group',
     *   groupSlug: string|null,
     *   notebook: string,
     *   id?: string
     * }|null
     */
    private function noteListingMetaFromPath(string $path): ?array
    {
        if (preg_match(
            '#^/(users|groups)/([^/]+)/\.notes/([^/]+)(?:/([^/]+)\.md)?$#i',
            $path,
            $matches
        ) !== 1) {
            return null;
        }

        $root = strtolower($matches[1]);
        $owner = $matches[2];
        $notebook = $matches[3];
        $noteId = $matches[4] ?? null;
        $scope = $root === 'groups' ? 'group' : 'personal';
        $groupSlug = $scope === 'group' ? $owner : null;

        if ($noteId !== null && $noteId !== '') {
            return [
                'kind' => 'note',
                'owner' => $owner,
                'scope' => $scope,
                'groupSlug' => $groupSlug,
                'notebook' => $notebook,
                'id' => $noteId,
            ];
        }

        return [
            'kind' => 'notebook',
            'owner' => $owner,
            'scope' => $scope,
            'groupSlug' => $groupSlug,
            'notebook' => $notebook,
        ];
    }

    /**
     * List preview + tags from on-disk note frontmatter (one read).
     *
     * Shared-with-me stubs must surface tags the same way owned notes do —
     * collab only syncs the body section, so metadata lives in frontmatter.
     *
     * @return array{title: string, tags: list<string>}
     */
    private function noteListFieldsFromPath(string $path, string $fallbackId): array
    {
        $disk = $this->filesDisk();
        $key = $this->paths->virtualToStorageKey($path);
        if (! $disk->fileExists($key)) {
            return ['title' => $fallbackId, 'tags' => []];
        }
        $contents = $disk->get($key);
        if (! is_string($contents)) {
            return ['title' => $fallbackId, 'tags' => []];
        }

        // Notes list preview is body-first (frontmatter title is often "Untitled").
        [, $tags] = $this->noteCodec->parse($contents, $fallbackId);

        return [
            'title' => $this->noteCodec->listPreview($contents, $fallbackId),
            'tags' => $tags,
        ];
    }

    private function generatePublicToken(): string
    {
        return strtolower(bin2hex(random_bytes(16)));
    }

    private function assertPublicAccessCap(string $kind, string $access): void
    {
        if ($kind === 'public' && $access !== DriveShareAccess::VIEW) {
            throw new ApiHttpException(400, 'Public shares only support view access.', 'bad_request');
        }
    }

    private function assertGroupExists(string $slug): void
    {
        $exists = Principal::query()
            ->where('uri', 'principals/groups/'.$slug)
            ->exists();

        if (! $exists) {
            throw new ApiHttpException(400, 'Unknown group.', 'bad_request');
        }
    }

    private function parseGroupPrincipalKey(string $principalId): ?string
    {
        if (preg_match('#^groups/([a-z0-9_-]+)$#', $principalId, $matches) !== 1) {
            return null;
        }

        return $matches[1];
    }

    private function shareLifecycleStatus(DriveShare $share): string
    {
        if ($share->expires_at !== null && $share->expires_at->lessThanOrEqualTo(Carbon::now())) {
            return 'expired';
        }

        return 'active';
    }

    private function isShareLive(DriveShare $share, Carbon $now): bool
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
            $inherited = $sharePath !== $requestedPath;
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
                'source' => $this->grantSourceForShare($winningShare, $requestedPath),
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

    /**
     * @return array{sharesById: Collection<string|int, DriveShare>, grants: Collection<int, DriveShareGrant>}|null
     */
    private function loadScopedGrants(array $shareIds): array
    {
        /** @var Collection<int, DriveShare> $sharesById */
        $sharesById = DriveShare::query()
            ->whereIn('id', $shareIds)
            ->get()
            ->keyBy('id');

        /** @var Collection<int, DriveShareGrant> $grants */
        $grants = DriveShareGrant::query()
            ->with('share')
            ->whereIn('share_id', $shareIds)
            ->get();

        return ['sharesById' => $sharesById, 'grants' => $grants];
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

        $sharePath = $this->scope->normalize((string) $share->path);
        $source = $this->grantSourceForShare($share, $requestedPath);

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
        $source = $this->grantSourceForShare($share, $requestedPath);
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

    private function filesDisk(): Filesystem
    {
        return $this->storage->files();
    }

    private function revokeShareRecord(DriveShare $share): void
    {
        $now = Carbon::now();
        $share->revoked_at = $now;
        $share->save();

        DriveShareSession::query()
            ->where('share_id', $share->id)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => $now]);
    }

    /**
     * @return array{shareId: string, sharePath: string, inherited: bool, status: string}
     */
    private function grantSourceForShare(DriveShare $share, string $requestedPath): array
    {
        $sharePath = $this->scope->normalize((string) $share->path);

        return [
            'shareId' => (string) $share->id,
            'sharePath' => $sharePath,
            'inherited' => $sharePath !== $requestedPath,
            'status' => $this->shareLifecycleStatus($share),
        ];
    }

    private function principalTypeForQuery(string $principal): string
    {
        if (preg_match('#^groups/([a-z0-9_-]+)$#', $principal) === 1) {
            return 'group';
        }
        if (filter_var($principal, FILTER_VALIDATE_EMAIL) !== false) {
            return 'email';
        }

        return 'user';
    }

    private function normalizedPrincipalForResponse(string $principal, string $principalType): string
    {
        if ($principalType === 'email') {
            return strtolower($principal);
        }
        if ($principalType === 'user') {
            return strtolower($principal);
        }

        return $principal;
    }

    /**
     * @return list<string>
     */
    private function groupSlugsForUsername(string $username): array
    {
        $slugs = [];
        foreach ($this->groupDirectory->groupsForUser($username) as $group) {
            $uri = (string) ($group['id'] ?? '');
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
            $slug = $this->parseGroupPrincipalKey($principal);
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
        $source = $this->grantSourceForShare($share, $referencePath);

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
     * @param  list<string>  $virtualPaths
     * @return array<string, array{hasPublicShare: bool, hasTeamShare: bool}>
     */
    public function shareIndicatorsForPaths(string $ownerUsername, array $virtualPaths): array
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
            ->get(['id', 'path', 'kind']);

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
            /** @var list<string> $activeMemberShareIds */
            $activeMemberShareIds = DriveShareGrant::query()
                ->whereIn('share_id', $memberShareIds)
                ->where(function ($query): void {
                    $query->where(function ($inner): void {
                        $inner->where('grantee_type', 'user')->where('status', 'active');
                    })->orWhere(function ($inner): void {
                        $inner->where('grantee_type', 'group')->where('status', 'active');
                    });
                })
                ->distinct()
                ->pluck('share_id')
                ->map(static fn (mixed $id): string => (string) $id)
                ->all();

            $activeMemberShareIds = array_flip($activeMemberShareIds);
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

    /**
     * @param  list<string>  $virtualPaths
     * @return array<string, true> normalized virtual path => true
     *
     * @deprecated Use shareIndicatorsForPaths() for granular listing badges.
     */
    public function pathsWithOutgoingShares(string $ownerUsername, array $virtualPaths): array
    {
        $flags = [];
        foreach ($this->shareIndicatorsForPaths($ownerUsername, $virtualPaths) as $path => $indicator) {
            if ($indicator['hasPublicShare'] || $indicator['hasTeamShare']) {
                $flags[$path] = true;
            }
        }

        return $flags;
    }
}
