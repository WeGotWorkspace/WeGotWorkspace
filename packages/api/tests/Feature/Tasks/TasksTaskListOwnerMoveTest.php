<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use Tests\Support\GroupCollectionOwnerMoves;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Task list owner moves: only an instance admin moves a group task list out of its group.
 */
final class TasksTaskListOwnerMoveTest extends WgwDatabaseTestCase
{
    use GroupCollectionOwnerMoves;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedGroupCollectionOwnerMoves();
    }

    public function test_only_an_admin_moves_a_group_task_list_out_of_its_group(): void
    {
        $this->assertOnlyAnAdminMovesAGroupCollectionOut('/api/v1/tasks/tasklists');
    }

    public function test_a_member_moves_a_personal_task_list_into_a_group(): void
    {
        $this->assertAMemberMovesAPersonalCollectionIntoAGroup('/api/v1/tasks/tasklists');
    }
}
