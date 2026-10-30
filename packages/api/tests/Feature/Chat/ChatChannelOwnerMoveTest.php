<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use Tests\Support\GroupCollectionOwnerMoves;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chat channel owner moves: only an instance admin moves a group channel out of its group.
 */
final class ChatChannelOwnerMoveTest extends WgwDatabaseTestCase
{
    use GroupCollectionOwnerMoves;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedGroupCollectionOwnerMoves();
    }

    public function test_only_an_admin_moves_a_group_channel_out_of_its_group(): void
    {
        $this->assertOnlyAnAdminMovesAGroupCollectionOut('/api/v1/chat/channels', ['kind' => 'channel']);
    }

    public function test_a_member_moves_a_personal_channel_into_a_group(): void
    {
        $this->assertAMemberMovesAPersonalCollectionIntoAGroup('/api/v1/chat/channels', ['kind' => 'channel']);
    }
}
