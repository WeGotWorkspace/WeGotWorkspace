<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

use Tests\Support\LegacyAdministratorsTeam;

/**
 * Fixture principals of the ownership matrix (spec "Fixture principals").
 */
final class OwnershipPrincipals
{
    public const MEMBER = 'member';

    public const ADMIN = 'admin';

    /** Another user, member of `outsiders` only. */
    public const CAROL = 'carol';

    /** Another user, member of `crew` only; grants reach the actors through `crew`. */
    public const DAVE = 'dave';

    /** The actors' group. */
    public const CREW = 'crew';

    /** A group neither actor belongs to. */
    public const OUTSIDERS = 'outsiders';

    /** A group the actor leaves after its token is issued. */
    public const ALUMNI = 'alumni';

    public const ADMIN_GROUP_URI = LegacyAdministratorsTeam::URI;

    public static function groupUri(string $slug): string
    {
        return 'principals/groups/'.$slug;
    }

    /**
     * @return array<string, list<string>> group slug => member usernames
     */
    public static function memberships(): array
    {
        return [
            self::CREW => [self::MEMBER, self::ADMIN, self::DAVE],
            self::OUTSIDERS => [self::CAROL],
            self::ALUMNI => [self::MEMBER, self::ADMIN],
        ];
    }
}
