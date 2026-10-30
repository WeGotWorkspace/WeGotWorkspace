<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;

/**
 * Whether a caller holds a grant on a share it does not own. A sharee already sees the
 * share in `GET /files/shared-with-me`, so share management refuses it with 403, not 404.
 */
final class DriveShareShareeCheck
{
    public function __construct(
        private DriveGroupResolver $groups,
        private DriveSharePresenter $presenter,
        private DriveSharePathScope $scope,
    ) {}

    public function isShareeOf(string $username, string $shareId): bool
    {
        $user = strtolower(trim($username));
        /** @var DriveShare|null $share */
        $share = DriveShare::query()->find($shareId);
        if ($share === null
            || strtolower((string) $share->owner_username) === $user
            || ! $this->presenter->isShareLive($share, Carbon::now())
            || $this->scope->isInProductTrash((string) $share->path)) {
            return false;
        }

        $groupSlugs = $this->groups->allowedGroupSlugs($user);

        return DriveShareGrant::query()
            ->where('share_id', (string) $share->id)
            ->where('status', 'active')
            ->where(function (Builder $query) use ($user, $groupSlugs): void {
                $query->where(function (Builder $direct) use ($user): void {
                    $direct->where('grantee_type', 'user')->where('grantee_user', $user);
                });
                if ($groupSlugs !== []) {
                    $query->orWhere(function (Builder $viaGroup) use ($groupSlugs): void {
                        $viaGroup->where('grantee_type', 'group')->whereIn('grantee_group', $groupSlugs);
                    });
                }
            })
            ->exists();
    }
}
