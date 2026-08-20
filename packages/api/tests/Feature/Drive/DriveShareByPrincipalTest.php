<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShareGrant;
use App\Models\Principal;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareByPrincipalTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->ownerToken = $this->userBearerToken();
        $this->createDriveDirectory('/users/bob', 'projects');
        $this->createDriveDirectory('/users/bob/projects', 'q3');
        $this->createDriveFile($this->ownerToken, '/users/bob/projects/q3', 'draft.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_user_with_grants_on_two_paths_returns_two_entries(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/by-principal?principal=alice'
        );
        $response->assertOk()
            ->assertJsonPath('data.principal', 'alice')
            ->assertJsonPath('data.queriedPrincipalType', 'user');

        $entries = (array) $response->json('data.entries');
        $this->assertCount(2, $entries);
        $paths = array_map(static fn (array $row): string => (string) $row['source']['sharePath'], $entries);
        $this->assertContains('/users/bob/projects', $paths);
        $this->assertContains('/users/bob/projects/q3/draft.md', $paths);
    }

    public function test_group_access_via_queried_user_membership_not_caller(): void
    {
        $designTeam = $this->seedWgwGroup('principals/groups/design-team', 'Design Team');
        $this->seedWgwUser('priya', displayName: 'Priya');
        $priya = Principal::forUsername('priya');
        $this->assertNotNull($priya);
        $this->addPrincipalToGroup($designTeam, $priya);

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['groups/design-team' => ['access' => 'edit']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/by-principal?principal=priya'
        );
        $response->assertOk();

        $response->assertJsonPath('data.queriedPrincipalType', 'user');

        $entries = (array) $response->json('data.entries');
        $this->assertCount(1, $entries);
        $this->assertSame('group', $entries[0]['principalType']);
        $this->assertSame('groups/design-team', $entries[0]['viaGroup']);
        $this->assertSame('edit', $entries[0]['access']);
        $this->assertSame('active', $entries[0]['source']['status']);
    }

    public function test_email_pending_grant(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['wren@outside.dev' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/by-principal?principal='.urlencode('wren@outside.dev')
        );
        $response->assertOk()
            ->assertJsonPath('data.queriedPrincipalType', 'email');

        $entries = (array) $response->json('data.entries');
        $this->assertCount(1, $entries);
        $this->assertSame('pending', $entries[0]['status']);
        $this->assertSame('active', $entries[0]['source']['status']);
        $this->assertSame('deleteInvite', $entries[0]['removal']['method']);
    }

    public function test_email_accepted_guest_grant(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['wren@outside.dev' => ['access' => 'edit']],
        ])->assertOk();

        $grant = DriveShareGrant::query()
            ->where('grantee_email', 'wren@outside.dev')
            ->where('status', 'pending')
            ->first();
        $this->assertNotNull($grant);

        $this->withBearer($this->carolBearerToken())->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => (string) $grant->invite_token,
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/by-principal?principal='.urlencode('wren@outside.dev')
        );
        $response->assertOk();

        $response->assertJsonPath('data.queriedPrincipalType', 'email');

        $entries = (array) $response->json('data.entries');
        $this->assertCount(1, $entries);
        $this->assertSame('active', $entries[0]['status']);
        $this->assertSame('user', $entries[0]['principalType']);
        $this->assertSame('wren@outside.dev', $entries[0]['invitedEmail']);
        $this->assertSame('patchShareWith', $entries[0]['removal']['method']);
        $this->assertSame('carol', $entries[0]['removal']['principal']);
    }

    public function test_user_query_includes_invited_email_for_guest_grant(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['wren@outside.dev' => ['access' => 'edit']],
        ])->assertOk();

        $grant = DriveShareGrant::query()
            ->where('grantee_email', 'wren@outside.dev')
            ->where('status', 'pending')
            ->first();
        $this->assertNotNull($grant);

        $this->withBearer($this->carolBearerToken())->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => (string) $grant->invite_token,
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/by-principal?principal=carol'
        );
        $response->assertOk()
            ->assertJsonPath('data.principal', 'carol')
            ->assertJsonPath('data.queriedPrincipalType', 'user');

        $entries = (array) $response->json('data.entries');
        $this->assertCount(1, $entries);
        $this->assertSame('user', $entries[0]['principalType']);
        $this->assertSame('wren@outside.dev', $entries[0]['invitedEmail']);
    }

    public function test_group_principal_query(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['groups/team' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/by-principal?principal='.urlencode('groups/team')
        );
        $response->assertOk()
            ->assertJsonPath('data.queriedPrincipalType', 'group');

        $entries = (array) $response->json('data.entries');
        $this->assertCount(1, $entries);
        $this->assertSame('group', $entries[0]['principalType']);
    }

    public function test_non_owner_scope_gets_forbidden(): void
    {
        $this->withBearer($this->carolBearerToken())->getJson(
            '/api/v1/files/shares/by-principal?principal=alice&scope='.urlencode('/users/bob/projects')
        )->assertStatus(403);
    }

    public function test_scope_filter_limits_entries(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/by-principal?principal=alice&scope='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $entries = (array) $response->json('data.entries');
        $this->assertCount(1, $entries);
        $this->assertSame('/users/bob/projects/q3/draft.md', $entries[0]['source']['sharePath']);
        $this->assertSame('descendant', $entries[0]['relationship']);
    }

    public function test_route_not_shadowed_by_share_id_param(): void
    {
        $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/by-principal?principal=alice'
        )->assertOk()
            ->assertJsonPath('data.entries', []);
    }
}
