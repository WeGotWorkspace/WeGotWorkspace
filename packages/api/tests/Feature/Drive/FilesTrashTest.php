<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Services\Drive\DriveService;
use Illuminate\Support\Facades\Storage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class FilesTrashTest extends WgwDatabaseTestCase
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

    public function test_move_to_trash_retains_blob_and_updates_listings(): void
    {
        $token = $this->userBearerToken();
        $this->createDriveFile($token, '/users/bob', 'report.md');
        $this->ensureTrashDirectory($token, 'bob');

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/.Trash',
            '/users/bob/report.md',
            'report.md',
        ));

        $this->assertTrue(Storage::disk('wgw_files')->exists('users/bob/.Trash/report.md'));

        $source = $this->withBearer($token)->getJson('/api/v1/files/children?path=/users/bob');
        $source->assertOk()->assertJsonMissing(['name' => 'report.md']);

        $trash = $this->withBearer($token)->getJson('/api/v1/files/children?path=/users/bob/.Trash');
        $trash->assertOk()->assertJsonFragment(['name' => 'report.md', 'type' => 'file']);
    }

    public function test_move_to_trash_picks_unique_name_when_collision(): void
    {
        $token = $this->userBearerToken();
        $this->ensureTrashDirectory($token, 'bob');
        Storage::disk('wgw_files')->put('users/bob/.Trash/Untitled.md', 'trashed');
        $this->createDriveFile($token, '/users/bob', 'Untitled.md');

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/.Trash',
            '/users/bob/Untitled.md',
            'Untitled.md',
        );

        $this->assertTrue(Storage::disk('wgw_files')->exists('users/bob/.Trash/Untitled.md'));
        $this->assertTrue(Storage::disk('wgw_files')->exists('users/bob/.Trash/Untitled 2.md'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/bob/Untitled.md'));
    }

    public function test_permanent_delete_from_trash_removes_file_and_index(): void
    {
        $token = $this->userBearerToken();
        $this->createDriveFile($token, '/users/bob', 'old.md');
        $this->ensureTrashDirectory($token, 'bob');

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/.Trash',
            '/users/bob/old.md',
            'old.md',
        );

        $this->assertSame('Deleted', app(DriveService::class)->deleteItems(
            $this->drivePrincipal('bob'),
            [['path' => '/users/bob/.Trash/old.md']],
        ));

        $this->assertFalse(Storage::disk('wgw_files')->exists('users/bob/.Trash/old.md'));
        $this->assertSearchDocumentMissing('users/bob/.Trash/old.md');

        $this->withBearer($token)->get('/api/v1/files/content?path=/users/bob/.Trash/old.md')
            ->assertStatus(400)
            ->assertJsonPath('error', 'File not found.');

        $listing = $this->withBearer($token)->getJson('/api/v1/files/children?path=/users/bob/.Trash');
        $listing->assertOk()->assertJsonMissing(['name' => 'old.md']);
    }
}
