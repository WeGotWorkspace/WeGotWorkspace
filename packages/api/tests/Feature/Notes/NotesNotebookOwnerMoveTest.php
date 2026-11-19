<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use Tests\Support\GroupCollectionOwnerMoves;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Notebook owner moves: only a team admin moves a Team notebook out of its Team or into it (#2278).
 */
final class NotesNotebookOwnerMoveTest extends WgwDatabaseTestCase
{
    use GroupCollectionOwnerMoves;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedGroupCollectionOwnerMoves();
    }

    public function test_only_a_team_admin_moves_a_group_notebook_out_of_its_group(): void
    {
        $this->assertOnlyAnAdminMovesAGroupCollectionOut('/api/v1/notes/notebooks');
    }

    public function test_only_a_team_admin_moves_a_personal_notebook_into_a_group(): void
    {
        $this->assertOnlyATeamAdminMovesAPersonalCollectionIntoAGroup('/api/v1/notes/notebooks');
    }
}
