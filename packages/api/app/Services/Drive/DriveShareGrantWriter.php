<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Exceptions\ApiHttpException;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Storage\StoragePaths;
use Illuminate\Support\Str;

/**
 * Writes member, group, and email grants onto an existing share.
 */
final class DriveShareGrantWriter
{
    public function __construct(
        private StoragePaths $paths,
        private DriveShareRules $rules,
    ) {}

    /**
     * @param  array<string, mixed>  $shareWith
     */
    public function mergeShareWith(DriveShare $share, array $shareWith): void
    {
        $isNotePath = $this->paths->isNotePath((string) $share->path);

        foreach ($shareWith as $principalId => $grantValue) {
            $principalId = trim((string) $principalId);
            if ($principalId === '') {
                throw new ApiHttpException(400, 'shareWith principal id must not be empty.', 'bad_request');
            }

            $isEmail = filter_var($principalId, FILTER_VALIDATE_EMAIL) !== false;
            $groupSlug = $this->rules->parseGroupPrincipalKey($principalId);

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
                $this->rules->assertNotePathAccessAllowed($rawAccess);
            }
            $access = $this->rules->normalizeAccess($rawAccess);
            if (! $isNotePath) {
                $this->rules->assertCommentReviewApplicable($share->path, $access);
            }

            if ($isEmail) {
                $this->upsertEmailGrant($share, strtolower($principalId), $access);

                continue;
            }

            if ($groupSlug !== null) {
                $this->rules->assertGroupExists($groupSlug);
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

    public function upsertEmailInviteGrant(DriveShare $share, string $email, string $access): DriveShareGrant
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
}
