<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class AdminGroupsTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_admin_can_create_update_and_delete_group(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->postJson('/api/v1/admin/groups', [
                'name' => 'Support Team',
                'displayName' => 'Support Team',
            ])
            ->assertOk();

        $groupNotes = $this->adminDataDirectory().'/files/groups/support-team/.notes';
        $this->assertTrue(is_dir($groupNotes));
        $this->assertTrue(is_dir($groupNotes.'/General'));

        $this->withBearer($token)
            ->patchJson('/api/v1/admin/groups/support-team', [
                'displayName' => 'Support',
                'members' => ['bob', 'carol'],
            ])
            ->assertOk();

        $state = $this->withBearer($token)->getJson('/api/v1/admin/state');
        $state->assertOk();
        $groupIds = array_column($state->json('groups'), 'id');
        $this->assertContains('principals/groups/support-team', $groupIds);

        $bob = collect($state->json('users'))->firstWhere('username', 'bob');
        $this->assertIsArray($bob);
        $this->assertContains('principals/groups/support-team', $bob['groups']);

        $this->withBearer($token)
            ->deleteJson('/api/v1/admin/groups/support-team')
            ->assertOk();

        $groupIdsAfter = array_column(
            $this->withBearer($token)->getJson('/api/v1/admin/state')->json('groups'),
            'id',
        );
        $this->assertNotContains('principals/groups/support-team', $groupIdsAfter);
        $this->assertFalse(is_dir($this->adminDataDirectory().'/files/groups/support-team'));
    }

    public function test_administrators_group_cannot_be_deleted(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->deleteJson('/api/v1/admin/groups/administrators')
            ->assertBadRequest()
            ->assertJsonPath('error', 'The administrators group cannot be deleted.');
    }

    public function test_admin_cannot_remove_self_from_administrators(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->deleteJson('/api/v1/admin/groups/administrators/members/alice')
            ->assertBadRequest()
            ->assertJsonPath('error', 'You cannot remove your own administrator access.');

        $this->withBearer($token)
            ->patchJson('/api/v1/admin/groups/administrators', [
                'members' => ['bob'],
            ])
            ->assertBadRequest()
            ->assertJsonPath('error', 'You cannot remove your own administrator access.');
    }

    public function test_admin_can_add_group_member_via_member_endpoint(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->postJson('/api/v1/admin/groups', [
                'name' => 'Editors',
                'displayName' => 'Editors',
            ])
            ->assertOk();

        $this->withBearer($token)
            ->putJson('/api/v1/admin/groups/editors/members/bob')
            ->assertOk();

        $bob = collect(
            $this->withBearer($token)->getJson('/api/v1/admin/state')->json('users'),
        )->firstWhere('username', 'bob');
        $this->assertIsArray($bob);
        $this->assertContains('principals/groups/editors', $bob['groups']);
    }
}
