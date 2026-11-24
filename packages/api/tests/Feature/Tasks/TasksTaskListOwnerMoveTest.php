<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use Tests\Support\GroupCollectionOwnerMoves;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Task list owner moves: only a team admin moves a Team task list out of its Team or into it (#2278).
 */
final class TasksTaskListOwnerMoveTest extends WgwDatabaseTestCase
{
    use GroupCollectionOwnerMoves;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedGroupCollectionOwnerMoves();
    }

    public function test_only_a_team_admin_moves_a_group_task_list_out_of_its_group(): void
    {
        $this->assertOnlyAnAdminMovesAGroupCollectionOut('/api/v1/tasks/tasklists');
    }

    public function test_only_a_team_admin_moves_a_personal_task_list_into_a_group(): void
    {
        $this->assertOnlyATeamAdminMovesAPersonalCollectionIntoAGroup('/api/v1/tasks/tasklists');
    }
}
