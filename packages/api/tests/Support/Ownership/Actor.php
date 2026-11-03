<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

/**
 * Who sends the request in an ownership matrix case.
 */
enum Actor: string
{
    case Anonymous = 'anonymous';
    case Guest = 'guest';
    case Member = 'member';
    case Admin = 'admin';

    /**
     * Actors that own objects and belong to groups in the fixture world.
     *
     * @return list<self>
     */
    public static function signedIn(): array
    {
        return [self::Member, self::Admin];
    }
}
