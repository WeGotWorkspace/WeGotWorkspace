<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Services\Drive\DriveService;
use App\Storage\WgwStorage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

/**
 * REST (DriveService) and JMAP move or delete the Yjs sidecar with the document.
 * A rename inside one principal is the common case and still moves it.
 */
final class CollabSidecarMoveDeleteTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithFileNodeJmap;

    private const DOC = '/users/bob/docs/note.md';

    private const DOC_KEY = 'users/bob/docs/note.md';

    private const SIDECAR_KEY = 'users/bob/docs/.note.md.yjs';

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

    public function test_same_principal_rename_moves_the_sidecar(): void
    {
        $this->seedDocument();

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/docs',
            self::DOC,
            'renamed.md',
        ));

        $disk = app(WgwStorage::class)->files();
        $this->assertFalse($disk->fileExists(self::DOC_KEY));
        $this->assertFalse($disk->fileExists(self::SIDECAR_KEY));
        $this->assertSame('# note', $disk->get('users/bob/docs/renamed.md'));
        $this->assertSame('yjs-history', $disk->get('users/bob/docs/.renamed.md.yjs'));
    }

    public function test_same_principal_move_into_another_folder_moves_the_sidecar(): void
    {
        $this->seedDocument();
        $this->createDriveDirectory('/users/bob', 'archive');

        $moved = app(DriveService::class)->movePath(
            $this->drivePrincipal('bob'),
            self::DOC,
            '/users/bob/archive/note.md',
        );

        $this->assertSame('/users/bob/archive/note.md', $moved['to']);
        $disk = app(WgwStorage::class)->files();
        $this->assertFalse($disk->fileExists(self::SIDECAR_KEY));
        $this->assertSame('yjs-history', $disk->get('users/bob/archive/.note.md.yjs'));
        $this->assertSame('# note', $disk->get('users/bob/archive/note.md'));
    }

    public function test_delete_removes_the_sidecar(): void
    {
        $this->seedDocument();

        $this->assertSame('Deleted', app(DriveService::class)->deleteItems(
            $this->drivePrincipal('bob'),
            [['path' => self::DOC]],
        ));

        $disk = app(WgwStorage::class)->files();
        $this->assertFalse($disk->fileExists(self::DOC_KEY));
        $this->assertFalse($disk->fileExists(self::SIDECAR_KEY));
    }

    public function test_directory_delete_removes_sidecars_inside_it(): void
    {
        $this->seedDocument();

        $this->assertSame('Deleted', app(DriveService::class)->deleteItems(
            $this->drivePrincipal('bob'),
            [['path' => '/users/bob/docs']],
        ));

        $disk = app(WgwStorage::class)->files();
        $this->assertFalse($disk->directoryExists('users/bob/docs'));
        $this->assertFalse($disk->fileExists(self::SIDECAR_KEY));
    }

    public function test_jmap_rename_in_the_same_principal_moves_the_sidecar(): void
    {
        $this->seedDocument();
        $nodes = $this->fileNodeGetAll();
        $fileId = $this->fileNodeIdByName($nodes, 'note.md');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['name' => 'renamed.md']]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$fileId, null);

        $disk = app(WgwStorage::class)->files();
        $this->assertFalse($disk->fileExists(self::SIDECAR_KEY));
        $this->assertSame('yjs-history', $disk->get('users/bob/docs/.renamed.md.yjs'));
    }

    public function test_jmap_move_into_another_folder_moves_the_sidecar(): void
    {
        $this->seedDocument();
        app(WgwStorage::class)->files()->makeDirectory('users/bob/archive');
        $nodes = $this->fileNodeGetAll();
        $fileId = $this->fileNodeIdByName($nodes, 'note.md');
        $archiveId = $this->fileNodeIdByName($nodes, 'archive');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['parentId' => $archiveId]]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$fileId, null);

        $disk = app(WgwStorage::class)->files();
        $this->assertFalse($disk->fileExists(self::SIDECAR_KEY));
        $this->assertSame('yjs-history', $disk->get('users/bob/archive/.note.md.yjs'));
    }

    public function test_jmap_destroy_removes_the_sidecar(): void
    {
        $this->seedDocument();
        $nodes = $this->fileNodeGetAll();
        $fileId = $this->fileNodeIdByName($nodes, 'note.md');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$fileId]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $fileId);

        $disk = app(WgwStorage::class)->files();
        $this->assertFalse($disk->fileExists(self::DOC_KEY));
        $this->assertFalse($disk->fileExists(self::SIDECAR_KEY));
    }

    private function seedDocument(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put(self::DOC_KEY, '# note');
        $disk->put(self::SIDECAR_KEY, 'yjs-history');
    }
}
