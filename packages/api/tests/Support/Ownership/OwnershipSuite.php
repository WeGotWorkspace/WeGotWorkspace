<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

/**
 * A domain test class in tests/Feature/Ownership that declares matrix rows.
 * The coverage guard discovers implementations and reads their cases.
 */
interface OwnershipSuite
{
    /**
     * Pure data: must not touch the app or the database.
     *
     * @return list<OwnershipCase>
     */
    public static function ownershipCases(): array;
}
