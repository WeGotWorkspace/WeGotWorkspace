<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShare;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareRevokeAllPublicTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->ownerToken = $this->userBearerToken();
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/directories?path=/users/bob', [
            'name' => 'projects',
        ])->assertOk();
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/directories?path=/users/bob/projects', [
            'name' => 'q3',
        ])->assertOk();
        $this->createDriveFile($this->ownerToken, '/users/bob/projects/q3', 'draft.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_revoke_all_public_under_path(): void
    {
        $rootPublic = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $nestedPublic = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $memberShare = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $this->createDriveFile($this->ownerToken, '/users/bob', 'outside.md');
        $outsidePublic = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/outside.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->postJson(
            '/api/v1/files/shares/public/revoke-all?path='.urlencode('/users/bob/projects')
        );
        $response->assertOk()
            ->assertJsonPath('data.revokedCount', 2);

        $revokedIds = (array) $response->json('data.shareIds');
        $this->assertContains((string) $rootPublic->json('data.id'), $revokedIds);
        $this->assertContains((string) $nestedPublic->json('data.id'), $revokedIds);
        $this->assertNotContains((string) $outsidePublic->json('data.id'), $revokedIds);

        $rootShare = DriveShare::query()->find((string) $rootPublic->json('data.id'));
        $this->assertNotNull($rootShare);
        $this->assertNotNull($rootShare->revoked_at);

        $nestedShare = DriveShare::query()->find((string) $nestedPublic->json('data.id'));
        $this->assertNotNull($nestedShare);
        $this->assertNotNull($nestedShare->revoked_at);

        $member = DriveShare::query()->find((string) $memberShare->json('data.id'));
        $this->assertNotNull($member);
        $this->assertNull($member->revoked_at);

        $outside = DriveShare::query()->find((string) $outsidePublic->json('data.id'));
        $this->assertNotNull($outside);
        $this->assertNull($outside->revoked_at);
    }

    public function test_non_owner_gets_forbidden(): void
    {
        $this->withBearer($this->carolBearerToken())->postJson(
            '/api/v1/files/shares/public/revoke-all?path='.urlencode('/users/bob/projects')
        )->assertStatus(403);
    }

    public function test_route_not_shadowed_by_share_id_param(): void
    {
        $this->withBearer($this->ownerToken)->postJson(
            '/api/v1/files/shares/public/revoke-all?path='.urlencode('/users/bob/projects')
        )->assertOk()
            ->assertJsonPath('data.revokedCount', 0);
    }
}
