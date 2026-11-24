<?php

declare(strict_types=1);

namespace Tests\Feature\Projects\Cycle;

use Tests\Support\WgwDatabaseTestCase;

/**
 * #819: the membership cycle of one Team and one Project, seen through Notes.
 */
final class NotesCycleTest extends WgwDatabaseTestCase
{
    use WalksTheMembershipCycle;

    public function test_the_membership_cycle_in_notes(): void
    {
        $this->walkTheCycle();
    }

    protected function seesProjectContent(string $user): ?bool
    {
        return in_array($this->resource('notebookId'), $this->idsOf($user, '/api/v1/notes/notebooks'), true);
    }
}
