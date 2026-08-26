<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarInstance;
use App\Services\Admin\AdminConstants;

/**
 * Meet ownerPrincipal / createdBy markers from calendar principals.
 */
final class CalendarMeetOwnerPrincipal
{
    public static function fromInstance(CalendarInstance $instance): string
    {
        return self::fromPrincipalUri((string) $instance->principaluri);
    }

    public static function fromPrincipalUri(string $principalUri): string
    {
        if (str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return 'groups/'.substr($principalUri, strlen(AdminConstants::GROUP_PREFIX));
        }
        if (str_starts_with($principalUri, 'principals/')) {
            return 'u:'.substr($principalUri, strlen('principals/'));
        }

        return 'u:'.$principalUri;
    }

    public static function actorMarker(string $username): string
    {
        return 'u:'.$username;
    }
}
