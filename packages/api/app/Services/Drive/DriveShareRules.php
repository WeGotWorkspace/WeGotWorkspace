<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Exceptions\ApiHttpException;
use App\Models\Principal;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Carbon;

/**
 * Share create/update input normalization and path policy.
 */
final class DriveShareRules
{
    public function __construct(
        private StoragePaths $paths,
        private DriveSharePathScope $scope,
        private DriveGroupResolver $groups,
        private CollabDocFormats $collabDocFormats,
        private WgwStorage $storage,
    ) {}

    public function requiredPath(mixed $value): string
    {
        if (! is_string($value) || trim($value) === '') {
            throw new ApiHttpException(400, 'path is required.', 'bad_request');
        }

        return $this->scope->normalize($value);
    }

    public function normalizeKind(mixed $value): string
    {
        $kind = strtolower(trim((string) $value));
        if (! in_array($kind, ['public', 'member', 'guest'], true)) {
            throw new ApiHttpException(400, 'Invalid kind.', 'bad_request');
        }

        return $kind;
    }

    public function normalizeAccess(string $access): string
    {
        $normalized = DriveShareAccess::normalize($access);
        if (! DriveShareAccess::isValid($normalized)) {
            throw new ApiHttpException(400, 'Invalid access.', 'bad_request');
        }

        return $normalized;
    }

    public function parseOptionalDate(mixed $value): ?Carbon
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

    public function normalizeNullableString(mixed $value): ?string
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

    public function principalOwnsSharePath(string $username, string $path): bool
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

    public function assertSharePathOwnedBy(string $username, string $path): void
    {
        if ($this->principalOwnsSharePath($username, $path)) {
            return;
        }

        throw new ApiHttpException(403, 'Cannot share this path.', 'forbidden');
    }

    public function assertSharePathNotTopLevelDrive(string $path): void
    {
        if ($this->scope->isTopLevelDrive($path)) {
            throw new ApiHttpException(403, 'Cannot share this path.', 'forbidden');
        }
    }

    public function assertCommentReviewApplicable(string $path, string $access): void
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
    public function assertNotePathShareCreate(string $path, string $kind, string $rawAccess): void
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

    public function assertNotePathAccessAllowed(string $rawAccess): void
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

    public function assertNotePathShareTarget(string $path): void
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
     * @return array{
     *   kind: 'note'|'notebook',
     *   owner: string,
     *   scope: 'personal'|'group',
     *   groupSlug: string|null,
     *   notebook: string,
     *   id?: string
     * }|null
     */
    public function noteListingMetaFromPath(string $path): ?array
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

    public function generatePublicToken(): string
    {
        return strtolower(bin2hex(random_bytes(16)));
    }

    public function assertPublicAccessCap(string $kind, string $access): void
    {
        if ($kind === 'public' && $access !== DriveShareAccess::VIEW) {
            throw new ApiHttpException(400, 'Public shares only support view access.', 'bad_request');
        }
    }

    public function assertGroupExists(string $slug): void
    {
        $exists = Principal::query()
            ->where('uri', 'principals/groups/'.$slug)
            ->exists();

        if (! $exists) {
            throw new ApiHttpException(400, 'Unknown group.', 'bad_request');
        }
    }

    public function parseGroupPrincipalKey(string $principalId): ?string
    {
        if (preg_match('#^groups/([a-z0-9_-]+)$#', $principalId, $matches) !== 1) {
            return null;
        }

        return $matches[1];
    }

    private function filesDisk(): Filesystem
    {
        return $this->storage->files();
    }
}
