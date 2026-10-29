<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use Tests\Support\GroupCollectionOwnerMoves;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Notebook owner moves: only an instance admin moves a group notebook out of its group.
 */
final class NotesNotebookOwnerMoveTest extends WgwDatabaseTestCase
{
    use GroupCollectionOwnerMoves;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedGroupCollectionOwnerMoves();
    }

    public function test_only_an_admin_moves_a_group_notebook_out_of_its_group(): void
    {
        $this->assertOnlyAnAdminMovesAGroupCollectionOut('/api/v1/notes/notebooks');
    }

    public function test_a_member_moves_a_personal_notebook_into_a_group(): void
    {
        $this->assertAMemberMovesAPersonalCollectionIntoAGroup('/api/v1/notes/notebooks');
    }
}
