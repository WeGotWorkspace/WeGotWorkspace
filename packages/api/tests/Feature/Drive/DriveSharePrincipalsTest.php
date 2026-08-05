<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveSharePrincipalsTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->ownerToken = $this->userBearerToken();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_principals_search_finds_users_and_groups(): void
    {
        $response = $this->withBearer($this->ownerToken)->getJson('/api/v1/files/shares/principals?query=ali');
        $response->assertOk();

        $principals = array_column((array) $response->json('data'), 'principal');
        $this->assertContains('alice', $principals);

        $alice = collect((array) $response->json('data'))->firstWhere('principal', 'alice');
        $this->assertSame('user', $alice['principalType']);
        $this->assertSame('Alice', $alice['displayName']);
    }

    public function test_principals_search_finds_groups_by_name(): void
    {
        $response = $this->withBearer($this->ownerToken)->getJson('/api/v1/files/shares/principals?query=team');
        $response->assertOk();

        $team = collect((array) $response->json('data'))->firstWhere('principal', 'groups/team');
        $this->assertNotNull($team);
        $this->assertSame('group', $team['principalType']);
        $this->assertSame('Team', $team['displayName']);
        $this->assertGreaterThanOrEqual(2, $team['memberCount']);
    }

    public function test_principals_search_excludes_groups_container_principal(): void
    {
        $response = $this->withBearer($this->ownerToken)->getJson('/api/v1/files/shares/principals?query=groups');
        $response->assertOk();

        $principals = array_column((array) $response->json('data'), 'principal');
        $this->assertNotContains('groups', $principals);

        $displayNames = array_column((array) $response->json('data'), 'displayName');
        $this->assertNotContains('Groups', $displayNames);
    }

    public function test_principals_empty_query_returns_groups(): void
    {
        $response = $this->withBearer($this->ownerToken)->getJson('/api/v1/files/shares/principals');
        $response->assertOk();

        $principals = array_column((array) $response->json('data'), 'principal');
        $this->assertContains('groups/team', $principals);
    }

    public function test_principals_available_to_non_admin(): void
    {
        $this->withBearer($this->carolBearerToken())->getJson('/api/v1/files/shares/principals?query=alice')
            ->assertOk()
            ->assertJsonFragment(['principal' => 'alice', 'principalType' => 'user']);
    }

    public function test_principals_route_not_shadowed_by_share_id_param(): void
    {
        $this->withBearer($this->ownerToken)->getJson('/api/v1/files/shares/principals?query=team')
            ->assertOk()
            ->assertJsonFragment(['principal' => 'groups/team']);
    }
}
