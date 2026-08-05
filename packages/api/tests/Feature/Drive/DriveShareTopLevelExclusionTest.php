<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareTopLevelExclusionTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->ownerToken = $this->userBearerToken();
        $this->createDriveFile($this->ownerToken, '/users/bob', 'nested.md');
        $this->createDriveFile($this->ownerToken, '/groups/team', 'group-note.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @return iterable<string, array{0: string, 1: string}>
     */
    public static function topLevelShareKindProvider(): iterable
    {
        yield 'member on user home' => ['/users/bob', 'member'];
        yield 'public on user home' => ['/users/bob', 'public'];
        yield 'member on group drive' => ['/groups/team', 'member'];
        yield 'public on group drive' => ['/groups/team', 'public'];
    }

    #[DataProvider('topLevelShareKindProvider')]
    public function test_create_share_rejects_top_level_drive_roots(string $path, string $kind): void
    {
        $payload = [
            'path' => $path,
            'kind' => $kind,
            'defaultAccess' => 'view',
        ];
        if ($kind === 'member') {
            $payload['shareWith'] = ['carol' => ['access' => 'view']];
        }

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', $payload)
            ->assertStatus(403)
            ->assertJsonPath('code', 'forbidden');
    }

    public function test_at_path_reports_may_share_false_for_top_level_drive(): void
    {
        $this->withBearer($this->ownerToken)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode('/users/bob'))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayShare', false);

        $this->withBearer($this->ownerToken)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode('/groups/team'))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayShare', false);
    }

    public function test_nested_paths_remain_shareable(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/nested.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/groups/team/group-note.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $this->withBearer($this->ownerToken)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode('/users/bob/nested.md'))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayShare', true);
    }

    public function test_children_listing_under_drive_root_keeps_may_share_on_entries(): void
    {
        $response = $this->withBearer($this->ownerToken)
            ->getJson('/api/v1/files/children?path=/users/bob')
            ->assertOk();

        $nested = collect($response->json('data.files'))->firstWhere('name', 'nested.md');
        $this->assertNotNull($nested);
        $this->assertTrue($nested['myRights']['mayShare'] ?? false);
    }
}
