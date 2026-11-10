<?php

declare(strict_types=1);

namespace Tests\Support;

/**
 * The group that granted the admin role before #1925. After the role migration it
 * is an ordinary Team; fixtures keep it so tests look like an upgraded instance.
 */
final class LegacyAdministratorsTeam
{
    public const URI = 'principals/groups/administrators';
}
