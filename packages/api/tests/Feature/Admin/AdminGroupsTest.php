<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Models\ApiRefreshToken;
use App\Models\User;
use App\Services\Admin\AdminRoleWriter;
use Tests\Support\AdminTestFixtures;
use Tests\Support\LegacyAdministratorsTeam;
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

        $this->assertDatabaseHas('calendarinstances', [
            'principaluri' => 'principals/groups/support-team',
            'uri' => 'notes-support-team',
        ], 'wgw');
        $this->assertTrue(is_dir($this->adminDataDirectory().'/files/groups/support-team'));

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

        $groupListing = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/children?path=/groups')
            ->assertOk();
        $groupNames = array_column((array) $groupListing->json('data.files'), 'name');
        $this->assertContains('support-team', $groupNames);

        $groupHome = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/children?path=/groups/support-team')
            ->assertOk();
        $this->assertSame([], $groupHome->json('data.files'));

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

    public function test_the_old_administrators_team_can_be_deleted_without_changing_roles(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->deleteJson('/api/v1/admin/groups/administrators')
            ->assertOk();

        $this->assertDatabaseMissing('principals', ['uri' => LegacyAdministratorsTeam::URI], 'wgw');
        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk();
    }

    public function test_membership_of_the_old_administrators_team_does_not_change_roles(): void
    {
        $alice = $this->login('alice');

        $this->withBearer($alice['access_token'])
            ->patchJson('/api/v1/admin/groups/administrators', [
                'members' => ['bob'],
            ])
            ->assertOk();

        $this->assertSame(0, (int) ApiRefreshToken::query()
            ->where('token_hash', hash('sha256', $alice['refresh_token']))
            ->value('revoked'));
        $users = collect($this->withBearer($alice['access_token'])->getJson('/api/v1/admin/state')->assertOk()->json('users'));
        $this->assertTrue($users->firstWhere('username', 'alice')['isAdmin']);
        $this->assertFalse($users->firstWhere('username', 'bob')['isAdmin']);
    }

    public function test_removing_the_admin_role_revokes_the_users_refresh_token(): void
    {
        $this->grantAdminRole('bob');

        $alice = $this->login('alice');
        $bob = $this->login('bob');

        $this->withBearer($bob['access_token'])
            ->patchJson('/api/v1/admin/users/alice', [
                'isAdmin' => false,
            ])
            ->assertOk();

        $aliceHash = hash('sha256', $alice['refresh_token']);
        $bobHash = hash('sha256', $bob['refresh_token']);
        $this->assertSame(1, (int) ApiRefreshToken::query()->where('token_hash', $aliceHash)->value('revoked'));
        $this->assertSame(0, (int) ApiRefreshToken::query()->where('token_hash', $bobHash)->value('revoked'));

        $this->postRefresh($alice['refresh_token'])
            ->assertUnauthorized();
        $this->postRefresh($bob['refresh_token'])
            ->assertOk();
    }

    public function test_admin_cannot_remove_own_admin_role(): void
    {
        $this->grantAdminRole('bob');
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->patchJson('/api/v1/admin/users/alice', [
                'isAdmin' => false,
                'displayName' => 'Changed',
            ])
            ->assertBadRequest()
            ->assertJsonPath('error', 'You cannot remove your own administrator access.');

        $this->assertDatabaseHas('users', ['username' => 'alice', 'is_admin' => true], 'wgw');
        $this->assertDatabaseMissing('principals', ['uri' => 'principals/alice', 'displayname' => 'Changed'], 'wgw');
    }

    public function test_the_last_admin_cannot_be_removed(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->deleteJson('/api/v1/admin/users/alice')
            ->assertBadRequest()
            ->assertJsonPath('error', 'The last administrator cannot be removed.');

        try {
            app(AdminRoleWriter::class)->set('alice', false, 'someone-else');
            $this->fail('The last admin lost the role.');
        } catch (\InvalidArgumentException $e) {
            $this->assertSame('The last administrator cannot be removed.', $e->getMessage());
        }
        $this->assertDatabaseHas('users', ['username' => 'alice', 'is_admin' => true], 'wgw');
    }

    public function test_a_disabled_admin_does_not_count_as_another_administrator(): void
    {
        $this->grantAdminRole('bob');
        $token = $this->adminBearerToken();
        User::query()->where('username', 'bob')->update(['enabled' => false]);

        $this->withBearer($token)
            ->deleteJson('/api/v1/admin/users/alice')
            ->assertBadRequest()
            ->assertJsonPath('error', 'The last administrator cannot be removed.');
        $this->assertDatabaseHas('users', ['username' => 'alice', 'is_admin' => true], 'wgw');

        $this->withBearer($token)
            ->patchJson('/api/v1/admin/users/bob', ['isAdmin' => false])
            ->assertOk();
        $this->assertDatabaseHas('users', ['username' => 'bob', 'is_admin' => false], 'wgw');
    }

    public function test_admin_grants_the_role_and_it_takes_effect_on_the_next_sign_in(): void
    {
        $bob = $this->login('bob');
        $this->withBearer($bob['access_token'])
            ->getJson('/api/v1/admin/state')
            ->assertForbidden();

        $this->withBearer($this->adminBearerToken())
            ->patchJson('/api/v1/admin/users/bob', ['isAdmin' => true])
            ->assertOk();

        $this->postRefresh($bob['refresh_token'])
            ->assertUnauthorized();
        $this->withBearer($this->login('bob')['access_token'])
            ->getJson('/api/v1/admin/state')
            ->assertOk();
    }

    public function test_admin_creates_a_user_with_the_admin_role(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->postJson('/api/v1/admin/users', [
                'username' => 'dave',
                'password' => 'a-long-password',
                'displayName' => 'Dave',
                'isAdmin' => true,
            ])
            ->assertOk();
        $this->withBearer($token)
            ->postJson('/api/v1/admin/users', [
                'username' => 'erin',
                'password' => 'a-long-password',
                'displayName' => 'Erin',
            ])
            ->assertOk();

        $users = collect($this->withBearer($token)->getJson('/api/v1/admin/state')->json('users'));
        $this->assertTrue($users->firstWhere('username', 'dave')['isAdmin']);
        $this->assertFalse($users->firstWhere('username', 'erin')['isAdmin']);
        $this->assertSame([], $users->firstWhere('username', 'dave')['groups']);
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

    public function test_create_fails_without_a_principal_when_the_data_directory_is_read_only(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            $this->markTestSkipped('chmod cannot deny writes to the root user.');
        }

        $files = $this->adminDataDirectory().'/files';
        if (! chmod($files, 0555)) {
            $this->fail('Could not make the data files directory read-only.');
        }

        try {
            $this->withBearer($this->adminBearerToken())
                ->postJson('/api/v1/admin/groups', [
                    'name' => 'read-only-team',
                    'displayName' => 'Read Only Team',
                ])
                ->assertServerError();

            $this->assertDatabaseMissing('principals', [
                'uri' => 'principals/groups/read-only-team',
            ], 'wgw');
            $this->assertFalse(is_dir($files.'/groups/read-only-team'));
        } finally {
            chmod($files, 0775);
        }
    }

    /**
     * @return array{access_token: string, refresh_token: string}
     */
    private function login(string $username): array
    {
        $response = $this->postJson('/api/v1/auth/token', [
            'username' => $username,
            'password' => 'secret',
        ])->assertOk();

        return [
            'access_token' => (string) $response->json('access_token'),
            'refresh_token' => $this->refreshCookieValue($response),
        ];
    }
}
