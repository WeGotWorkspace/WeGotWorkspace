<?php

declare(strict_types=1);

namespace App\Services\Teams;

/**
 * Who a viewer may find: everyone who shares a Team with them, plus the viewer. An admin's
 * set is unrestricted ({@see TeamColleagues} Admin rule), so `contains` is true for anyone.
 */
final class ColleagueSet
{
    /** @var array<string, true> */
    private readonly array $index;

    /**
     * @param  list<string>  $teamMates  normalised usernames, viewer included
     */
    private function __construct(
        private readonly bool $unrestricted,
        private readonly array $teamMates,
    ) {
        $this->index = array_fill_keys($teamMates, true);
    }

    /**
     * @param  list<string>  $teamMates
     */
    public static function restricted(array $teamMates): self
    {
        return new self(false, $teamMates);
    }

    /**
     * @param  list<string>  $teamMates
     */
    public static function unrestricted(array $teamMates): self
    {
        return new self(true, $teamMates);
    }

    public function isUnrestricted(): bool
    {
        return $this->unrestricted;
    }

    public function contains(string $username): bool
    {
        return $this->unrestricted || isset($this->index[TeamMembershipReader::normalise($username)]);
    }

    /**
     * The viewer and everyone who shares a Team with them, sorted. For an unrestricted set
     * this is still only the real Team mates, not everyone: check `isUnrestricted()` before
     * using it as a directory.
     *
     * @return list<string>
     */
    public function usernames(): array
    {
        return $this->teamMates;
    }
}
