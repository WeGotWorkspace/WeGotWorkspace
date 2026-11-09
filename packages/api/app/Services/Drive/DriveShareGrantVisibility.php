<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Services\Admin\AdminConstants;
use App\Services\Teams\TeamColleagues;

/**
 * Epic #1915 for Drive and Docs: a member grant from a share owner who no longer shares a Team
 * with the grantee (or left the Team the share went to) is hidden on both sides, admins
 * included, the same rule as {@see TeamColleagues::grantIsVisible} for calendars and address
 * books. Computed on read, so nothing is stored or deleted and the grant comes back when they
 * share a Team again. Email (guest) grants and public links are not member grants and stay.
 */
final class DriveShareGrantVisibility
{
    public function __construct(private readonly TeamColleagues $colleagues) {}

    /**
     * Call before checking many grants held by one user ("shared with me", path access): every
     * owner is then checked against that user's Team mates instead of loading each owner's.
     */
    public function checkFromGrantee(string $username): void
    {
        $this->colleagues->loadTeamMatesOf($username);
    }

    public function isVisible(DriveShareGrant $grant, ?DriveShare $share = null): bool
    {
        $share ??= $grant->share;
        if ($share === null) {
            return true;
        }

        $grantee = match ((string) $grant->grantee_type) {
            'user' => 'principals/'.strtolower(trim((string) $grant->grantee_user)),
            'group' => AdminConstants::GROUP_PREFIX.trim((string) $grant->grantee_group),
            default => null,
        };

        return $grantee === null
            || $this->colleagues->grantIsVisible('principals/'.strtolower(trim((string) $share->owner_username)), $grantee);
    }
}
