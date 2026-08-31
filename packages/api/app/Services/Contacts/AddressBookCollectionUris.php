<?php

declare(strict_types=1);

namespace App\Services\Contacts;

/**
 * One CardDAV book per principal. Personal JMAP id is {@see self::PERSONAL_DEFAULT};
 * group membership books are listed as {@see self::groupApiId()}; inbound shares
 * are {@see self::sharedApiId()}.
 */
final class AddressBookCollectionUris
{
    public const PERSONAL_DEFAULT = 'default';

    /** CalDAV uri on both user and group principals. */
    public const CALDAV_URI = 'default';

    public static function groupApiId(string $groupSlug): string
    {
        return 'group-'.$groupSlug;
    }

    public static function parseGroupApiId(string $id): ?string
    {
        if (preg_match('#^group-([A-Za-z0-9._-]{1,190})$#', $id, $matches) !== 1) {
            return null;
        }

        return $matches[1];
    }

    public static function sharedApiId(int $addressBookId): string
    {
        return 'shared-'.$addressBookId;
    }

    public static function parseSharedApiId(string $id): ?int
    {
        if (preg_match('#^shared-(\d+)$#', $id, $matches) !== 1) {
            return null;
        }

        return (int) $matches[1];
    }
}
