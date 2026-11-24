<?php

declare(strict_types=1);

namespace Tests\Feature\Projects\Cycle;

use Tests\Support\WgwDatabaseTestCase;

/**
 * #819: the membership cycle of one Team and one Project, seen through Tasks.
 */
final class TasksCycleTest extends WgwDatabaseTestCase
{
    use WalksTheMembershipCycle;

    public function test_the_membership_cycle_in_tasks(): void
    {
        $this->walkTheCycle();
    }

    protected function seesProjectContent(string $user): ?bool
    {
        return in_array($this->resource('taskListId'), $this->idsOf($user, '/api/v1/tasks/tasklists'), true);
    }
}
