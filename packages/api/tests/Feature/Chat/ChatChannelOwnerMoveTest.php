<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use Tests\Support\GroupCollectionOwnerMoves;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chat channel owner moves: only a team admin moves a Team channel out of its Team or into it (#2278).
 */
final class ChatChannelOwnerMoveTest extends WgwDatabaseTestCase
{
    use GroupCollectionOwnerMoves;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedGroupCollectionOwnerMoves();
    }

    public function test_only_a_team_admin_moves_a_group_channel_out_of_its_group(): void
    {
        $this->assertOnlyAnAdminMovesAGroupCollectionOut('/api/v1/chat/channels', ['kind' => 'channel']);
    }

    public function test_only_a_team_admin_moves_a_personal_channel_into_a_group(): void
    {
        $this->assertOnlyATeamAdminMovesAPersonalCollectionIntoAGroup('/api/v1/chat/channels', ['kind' => 'channel']);
    }
}
