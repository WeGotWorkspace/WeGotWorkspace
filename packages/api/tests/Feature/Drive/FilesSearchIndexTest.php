<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Services\Drive\DriveService;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class FilesSearchIndexTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_create_indexes_private_drive_file(): void
    {
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'index-me.md');

        $this->assertSearchDocumentExists('users/bob/index-me.md');
    }

    public function test_rename_updates_search_index_keys(): void
    {
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'index-me.md');

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            '/users/bob/index-me.md',
            'index-renamed.md',
        );

        $this->assertSearchDocumentMissing('users/bob/index-me.md');
        $this->assertSearchDocumentExists('users/bob/index-renamed.md');
    }

    public function test_delete_removes_search_index_row(): void
    {
        $token = $this->userBearerToken();
        $this->createDriveFile($token, '/users/bob', 'index-me.md');
        $this->assertSearchDocumentExists('users/bob/index-me.md');

        app(DriveService::class)->deleteItems(
            $this->drivePrincipal('bob'),
            [['path' => '/users/bob/index-me.md']],
        );

        $this->assertSearchDocumentMissing('users/bob/index-me.md');

        $search = $this->withBearer($token)->getJson('/api/v1/search/results?'.http_build_query([
            'q' => 'index-me',
            'sources' => ['file'],
            'limit' => 20,
        ]));
        $search->assertOk()->assertJsonPath('data.results', []);
    }

    public function test_group_drive_mutations_sync_search_index(): void
    {
        $this->createDriveFile($this->userBearerToken(), '/groups/team', 'group-index.md');
        $this->assertSearchDocumentExists('groups/team/group-index.md');

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/groups/team',
            '/groups/team/group-index.md',
            'group-renamed.md',
        );

        $this->assertSearchDocumentMissing('groups/team/group-index.md');
        $this->assertSearchDocumentExists('groups/team/group-renamed.md');

        app(DriveService::class)->deleteItems(
            $this->drivePrincipal('bob'),
            [['path' => '/groups/team/group-renamed.md']],
        );
        $this->assertSearchDocumentMissing('groups/team/group-renamed.md');
    }
}
