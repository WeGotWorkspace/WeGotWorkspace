<?php

declare(strict_types=1);

namespace App\Services\Admin;

final class AdminConstants
{
    /** Parent principal so WebDAV paths under {@see self::GROUP_PREFIX} resolve segment by segment. */
    public const GROUP_CONTAINER_URI = 'principals/groups';

    public const GROUP_PREFIX = 'principals/groups/';
}
