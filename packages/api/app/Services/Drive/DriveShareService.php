<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Exceptions\ApiHttpException;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Models\DriveShareSession;
use App\Services\Auth\JwtTokenService;
use App\Storage\StoragePaths;
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
        private JwtTokenService $jwtTokens,
        private DriveShareSessionRateLimiter $rateLimiter,
        private DriveShareRules $rules,
        private DriveSharePresenter $presenter,
        private DriveShareGrantWriter $grantWriter,
        private DriveShareAtPathQuery $atPathQuery,
        private DriveShareByPrincipalQuery $byPrincipalQuery,
        private DriveShareNotifier $notifier,
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

        return $shares->map(fn (DriveShare $share): array => $this->presenter->serializeShareForOwner($share))->values()->all();
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
        $path = $this->rules->requiredPath($input['path'] ?? null);
        $kind = $this->rules->normalizeKind($input['kind'] ?? 'member');
        $rawDefaultAccess = strtolower(trim((string) ($input['defaultAccess'] ?? DriveShareAccess::VIEW)));
        $this->rules->assertSharePathOwnedBy($owner, $path);
        $this->rules->assertSharePathNotTopLevelDrive($path);
        $this->rules->assertNotePathShareCreate($path, $kind, $rawDefaultAccess);
        $defaultAccess = $this->rules->normalizeAccess($rawDefaultAccess);
        $expiresAt = $this->rules->parseOptionalDate($input['expiresAt'] ?? null);
        $password = $this->rules->normalizeNullableString($input['password'] ?? null);
        /** @var array<string, mixed>|null $shareWith */
        $shareWith = is_array($input['shareWith'] ?? null) ? $input['shareWith'] : null;

        if (! $this->paths->isNotePath($path)) {
            $this->rules->assertCommentReviewApplicable($path, $defaultAccess);
        }
        $this->rules->assertPublicAccessCap($kind, $defaultAccess);

        $publicToken = $kind === 'public' ? $this->rules->generatePublicToken() : null;

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
                $this->grantWriter->mergeShareWith($share, $shareWith);
            }

            $share->refresh();
            $serialized = $this->presenter->serializeShareForOwner($share);
            $this->notifier->notifySharees($owner, $share);

            return $serialized;
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function getShareForOwner(string $username, string $shareId): array
    {
        $share = $this->ownerShareOrFail($username, $shareId);

        return $this->presenter->serializeShareForOwner($share);
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
                    $this->rules->assertNotePathAccessAllowed($rawAccess);
                }
                $share->default_access = $this->rules->normalizeAccess($rawAccess);
                if (! $this->paths->isNotePath((string) $share->path)) {
                    $this->rules->assertCommentReviewApplicable($share->path, $share->default_access);
                }
                $this->rules->assertPublicAccessCap((string) $share->kind, $share->default_access);
            }
            if (array_key_exists('expiresAt', $input)) {
                $share->expires_at = $this->rules->parseOptionalDate($input['expiresAt']);
            }
            if (array_key_exists('password', $input)) {
                $password = $this->rules->normalizeNullableString($input['password']);
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

            $addedSharees = null;
            if (is_array($input['shareWith'] ?? null)) {
                $beforeSharees = $this->notifier->shareeUsernames($share);
                /** @var array<string, mixed> $shareWith */
                $shareWith = $input['shareWith'];
                $this->grantWriter->mergeShareWith($share, $shareWith);
                $share->refresh();
                $addedSharees = array_values(array_diff($this->notifier->shareeUsernames($share), $beforeSharees));
            } else {
                $share->refresh();
            }

            if ($addedSharees !== null && $addedSharees !== []) {
                $this->notifier->notifySharees($username, $share, $addedSharees);
            }

            return $this->presenter->serializeShareForOwner($share);
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
        $this->rules->assertSharePathOwnedBy($owner, $path);

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
        return $this->byPrincipalQuery->byPrincipal($ownerUsername, $principal, $scope);
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
        $access = $this->rules->normalizeAccess((string) ($input['access'] ?? ''));

        return DB::connection('wgw')->transaction(function () use ($username, $shareId, $email, $access): array {
            $share = $this->ownerShareOrFail($username, $shareId, lockForUpdate: true);
            if ($this->paths->isNotePath((string) $share->path)) {
                throw new ApiHttpException(400, 'Email invites are not supported for note paths.', 'bad_request');
            }
            $this->rules->assertCommentReviewApplicable($share->path, $access);

            $grant = $this->grantWriter->upsertEmailInviteGrant($share, $email, $access);

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
     * @param  array{username: string, role: string}  $principal
     * @return array<string, mixed>
     */
    public function atPath(array $principal, string $virtualPath): array
    {
        return $this->atPathQuery->atPath($principal, $virtualPath);
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
            if ($share === null || ! $this->presenter->isShareLive($share, $now)) {
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
                'share' => $this->presenter->serializeShareForMember($share, $access),
            ];
            $entry = $this->presenter->directoryEntryForSharePath((string) $share->path, $access);
            if ($entry !== null) {
                $row['entry'] = $entry;
            }
            $rows[] = $row;
        }

        foreach ($groupGrants as $grant) {
            $share = $grant->share;
            if ($share === null || ! $this->presenter->isShareLive($share, $now)) {
                continue;
            }
            $shareId = (string) $share->id;
            if (isset($directByShareId[$shareId])) {
                continue;
            }
            $slug = (string) $grant->grantee_group;
            $access = (string) $grant->access;
            $row = [
                'share' => $this->presenter->serializeShareForMember($share, $access),
                'viaGroup' => 'groups/'.$slug,
            ];
            $entry = $this->presenter->directoryEntryForSharePath((string) $share->path, $access);
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
}
