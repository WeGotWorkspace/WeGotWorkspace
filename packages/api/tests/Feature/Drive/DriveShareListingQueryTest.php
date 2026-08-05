<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareListingQueryTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->ownerToken = $this->userBearerToken();
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/directories?path=/users/bob', [
            'name' => 'bulk',
        ])->assertOk();
        for ($i = 0; $i < 25; $i++) {
            $this->createDriveFile($this->ownerToken, '/users/bob/bulk', 'bulk-'.$i.'.md');
        }
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    private string $ownerToken;

    public function test_listing_shared_directory_does_not_query_grants_per_entry(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/bulk',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $memberToken = $this->carolBearerToken();

        DB::connection('wgw')->flushQueryLog();
        DB::connection('wgw')->enableQueryLog();

        $this->withBearer($memberToken)->getJson('/api/v1/files/children?path=/users/bob/bulk')
            ->assertOk();

        $grantQueries = 0;
        foreach (DB::connection('wgw')->getQueryLog() as $query) {
            $sql = strtolower((string) ($query['query'] ?? ''));
            if (str_contains($sql, 'drive_share_grants')) {
                $grantQueries++;
            }
        }

        $this->assertLessThanOrEqual(1, $grantQueries, 'Expected at most one drive_share_grants query for listing');
    }

    public function test_children_listing_marks_paths_with_outgoing_shares(): void
    {
        $this->createDriveFile($this->ownerToken, '/users/bob', 'shared.md');
        $this->createDriveFile($this->ownerToken, '/users/bob', 'private.md');

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertOk();

        $files = collect($response->json('data.files'))->keyBy('name');
        $this->assertTrue($files->get('shared.md')['hasShares'] ?? false);
        $this->assertTrue($files->get('shared.md')['hasPublicShare'] ?? false);
        $this->assertFalse($files->get('shared.md')['hasTeamShare'] ?? false);
        $this->assertFalse($files->get('private.md')['hasShares'] ?? false);
    }

    public function test_children_listing_marks_team_grants_separately_from_public_link(): void
    {
        $this->createDriveFile($this->ownerToken, '/users/bob', 'team.md');

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/team.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertOk();

        $entry = collect($response->json('data.files'))->firstWhere('name', 'team.md');
        $this->assertTrue($entry['hasShares'] ?? false);
        $this->assertTrue($entry['hasTeamShare'] ?? false);
        $this->assertFalse($entry['hasPublicShare'] ?? false);
    }
}
