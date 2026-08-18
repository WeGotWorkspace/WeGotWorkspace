<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Storage\WgwStorage;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Authenticated tree I/O + ACL twins for the dual-REST writes removed in
 * jmap-files-rest-gone (create/rename/move/delete/download/bulk).
 */
final class JmapFileNodeAclTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithFileNodeJmap;

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

    public function test_authenticated_user_creates_and_downloads_private_file(): void
    {
        $nodes = $this->fileNodeGetAll();
        $homeId = $this->fileNodeIdByName($nodes, 'bob');
        $blobId = $this->uploadFileNodeBlob("# Notes\nHello drive");

        $created = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'f0' => ['parentId' => $homeId, 'name' => 'notes.md', 'blobId' => $blobId],
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.f0');

        $this->assertSame('file', $created['nodeType']);
        $this->assertTrue(Storage::disk('wgw_files')->exists('users/bob/notes.md'));

        $download = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/files/content?path=/users/bob/notes.md');
        $download->assertOk();
        $this->assertStringContainsString('Hello drive', $download->streamedContent());

        $jmapDownload = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$created['blobId'].'/notes.md')
            ->assertOk();
        $this->assertStringContainsString('Hello drive', $jmapDownload->getContent());
    }

    public function test_cross_user_create_is_denied(): void
    {
        $carolNodes = $this->fileNodeGetAll('carol', $this->carolBearerToken());
        $carolHome = $this->fileNodeIdByName($carolNodes, 'carol');
        $blobId = $this->uploadFileNodeBlob('nope');

        $response = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'f0' => ['parentId' => $carolHome, 'name' => 'intrusion.md', 'blobId' => $blobId],
            ]], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.1.notCreated.f0.type', 'invalidProperties');
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/carol/intrusion.md'));
    }

    public function test_cross_user_delete_and_rename_are_denied(): void
    {
        $this->seedPrivateFile('carol', 'private.md', 'carol secret');
        $carolNodes = $this->fileNodeGetAll('carol', $this->carolBearerToken());
        $fileId = $this->fileNodeIdByName($carolNodes, 'private.md');

        $rename = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['name' => 'hacked.md']]], 'c0'],
        ])->assertOk();
        $rename->assertJsonPath('methodResponses.0.1.notUpdated.'.$fileId.'.type', 'notFound');

        $delete = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$fileId]], 'c1'],
        ])->assertOk();
        $delete->assertJsonPath('methodResponses.0.1.notDestroyed.'.$fileId.'.type', 'notFound');

        $this->assertTrue(Storage::disk('wgw_files')->exists('users/carol/private.md'));
        $content = $this->withBearer($this->carolBearerToken())
            ->get('/api/v1/files/content?path=/users/carol/private.md');
        $content->assertOk();
        $this->assertSame('carol secret', $content->streamedContent());
    }

    public function test_group_member_can_crud_team_drive(): void
    {
        $nodes = $this->fileNodeGetAll();
        $teamId = $this->fileNodeIdByName($nodes, 'team');
        $blobId = $this->uploadFileNodeBlob('team file');

        $created = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'f0' => ['parentId' => $teamId, 'name' => 'shared.md', 'blobId' => $blobId],
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.f0');
        $fileId = $created['id'];

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['name' => 'shared-renamed.md']]], 'c1'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$fileId, null);

        $listing = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/children?path=/groups/team');
        $listing->assertOk()->assertJsonFragment(['name' => 'shared-renamed.md']);

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$fileId]], 'c2'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $fileId);
        $this->assertFalse(Storage::disk('wgw_files')->exists('groups/team/shared-renamed.md'));
    }

    public function test_non_member_cannot_write_group_drive(): void
    {
        $this->seedGroupFile('existing.md');
        $bobNodes = $this->fileNodeGetAll();
        $teamId = $this->fileNodeIdByName($bobNodes, 'team');
        $existingId = $this->fileNodeIdByName($bobNodes, 'existing.md');
        $carolBlob = $this->uploadFileNodeBlob('blocked', 'carol', $this->carolBearerToken());

        $create = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'carol', 'create' => [
                'f0' => ['parentId' => $teamId, 'name' => 'blocked.md', 'blobId' => $carolBlob],
            ]], 'c0'],
        ], $this->carolBearerToken())->assertOk();
        $create->assertJsonPath('methodResponses.0.1.notCreated.f0.type', 'invalidProperties');

        $rename = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'carol', 'update' => [$existingId => ['name' => 'stolen.md']]], 'c1'],
        ], $this->carolBearerToken())->assertOk();
        $rename->assertJsonPath('methodResponses.0.1.notUpdated.'.$existingId.'.type', 'notFound');

        $delete = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'carol', 'destroy' => [$existingId]], 'c2'],
        ], $this->carolBearerToken())->assertOk();
        $delete->assertJsonPath('methodResponses.0.1.notDestroyed.'.$existingId.'.type', 'notFound');
    }

    public function test_admin_does_not_bypass_private_filenode_acl(): void
    {
        $this->seedPrivateFile('carol', 'admin-proof.md', 'stay private');
        $carolNodes = $this->fileNodeGetAll('carol', $this->carolBearerToken());
        $fileId = $this->fileNodeIdByName($carolNodes, 'admin-proof.md');

        $aliceList = $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ], $this->adminBearerToken())->assertOk()->json('methodResponses.0.1.list');
        $this->assertNotContains('admin-proof.md', array_column($aliceList, 'name'));

        $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => 'alice', 'ids' => [$fileId]], 'c1'],
        ], $this->adminBearerToken())->assertOk()
            ->assertJsonPath('methodResponses.0.1.notFound.0', $fileId);
    }

    public function test_admin_with_group_membership_can_access_team_drive(): void
    {
        $this->seedGroupFile('admin-shared.md', 'admin can read');
        $aliceNodes = $this->fileNodeGetAll('alice', $this->adminBearerToken());
        $this->assertContains('admin-shared.md', array_column(array_values($aliceNodes), 'name'));
    }

    public function test_bulk_destroy_removes_multiple_allowed_nodes(): void
    {
        $nodes = $this->fileNodeGetAll();
        $homeId = $this->fileNodeIdByName($nodes, 'bob');
        $a = $this->uploadFileNodeBlob('a');
        $b = $this->uploadFileNodeBlob('b');

        $created = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'a0' => ['parentId' => $homeId, 'name' => 'bulk-a.md', 'blobId' => $a],
                'b0' => ['parentId' => $homeId, 'name' => 'bulk-b.md', 'blobId' => $b],
            ]], 'c0'],
        ])->assertOk();
        $idA = $created->json('methodResponses.0.1.created.a0.id');
        $idB = $created->json('methodResponses.0.1.created.b0.id');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$idA, $idB]], 'c1'],
        ])->assertOk();

        $listing = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/children?path=/users/bob');
        $listing->assertOk()
            ->assertJsonMissing(['name' => 'bulk-a.md'])
            ->assertJsonMissing(['name' => 'bulk-b.md']);
    }

    public function test_member_moves_between_private_and_group_drive(): void
    {
        $this->seedPrivateFile('bob', 'local.md', 'move me');
        $nodes = $this->fileNodeGetAll();
        $fileId = $this->fileNodeIdByName($nodes, 'local.md');
        $teamId = $this->fileNodeIdByName($nodes, 'team');
        $homeId = $this->fileNodeIdByName($nodes, 'bob');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['parentId' => $teamId]]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$fileId, null);
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/bob/local.md'));
        $this->assertTrue(Storage::disk('wgw_files')->exists('groups/team/local.md'));

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['parentId' => $homeId]]], 'c1'],
        ])->assertOk();
        $this->assertTrue(Storage::disk('wgw_files')->exists('users/bob/local.md'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('groups/team/local.md'));
    }

    public function test_non_member_cannot_move_into_or_out_of_group_drive(): void
    {
        $this->seedPrivateFile('carol', 'carol-local.md');
        $this->seedGroupFile('team-only.md');
        $carolNodes = $this->fileNodeGetAll('carol', $this->carolBearerToken());
        $carolFileId = $this->fileNodeIdByName($carolNodes, 'carol-local.md');
        $bobNodes = $this->fileNodeGetAll();
        $teamId = $this->fileNodeIdByName($bobNodes, 'team');
        $teamFileId = $this->fileNodeIdByName($bobNodes, 'team-only.md');

        $intoGroup = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'carol', 'update' => [$carolFileId => ['parentId' => $teamId]]], 'c0'],
        ], $this->carolBearerToken())->assertOk();
        $intoGroup->assertJsonPath('methodResponses.0.1.notUpdated.'.$carolFileId.'.type', 'invalidProperties');
        $this->assertTrue(Storage::disk('wgw_files')->exists('users/carol/carol-local.md'));

        $outOfGroup = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'carol', 'update' => [$teamFileId => ['parentId' => $this->fileNodeIdByName($carolNodes, 'carol')]]], 'c1'],
        ], $this->carolBearerToken())->assertOk();
        $outOfGroup->assertJsonPath('methodResponses.0.1.notUpdated.'.$teamFileId.'.type', 'notFound');
        $this->assertTrue(Storage::disk('wgw_files')->exists('groups/team/team-only.md'));
    }

    public function test_missing_item_name_is_rejected(): void
    {
        $nodes = $this->fileNodeGetAll();
        $homeId = $this->fileNodeIdByName($nodes, 'bob');

        $response = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'f0' => ['parentId' => $homeId, 'name' => ''],
            ]], 'c0'],
        ])->assertOk();
        $response->assertJsonPath('methodResponses.0.1.notCreated.f0.type', 'invalidProperties');
        $response->assertJsonPath('methodResponses.0.1.notCreated.f0.properties.0', 'name');
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function invalidItemNamesProvider(): iterable
    {
        yield 'dot' => ['.'];
        yield 'dotdot' => ['..'];
        yield 'slash' => ['bad/name'];
        yield 'backslash' => ['bad\\name'];
    }

    #[DataProvider('invalidItemNamesProvider')]
    public function test_invalid_item_names_are_rejected(string $name): void
    {
        $nodes = $this->fileNodeGetAll();
        $homeId = $this->fileNodeIdByName($nodes, 'bob');

        $response = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'f0' => ['parentId' => $homeId, 'name' => $name],
            ]], 'c0'],
        ])->assertOk();
        $response->assertJsonPath('methodResponses.0.1.notCreated.f0.type', 'invalidProperties');
        $this->assertSame('name', $response->json('methodResponses.0.1.notCreated.f0.properties.0'));
    }

    public function test_rename_to_existing_name_is_already_exists(): void
    {
        $this->seedPrivateFile('bob', 'first.md');
        $this->seedPrivateFile('bob', 'second.md');
        $nodes = $this->fileNodeGetAll();
        $firstId = $this->fileNodeIdByName($nodes, 'first.md');

        $conflict = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$firstId => ['name' => 'second.md']]], 'c0'],
        ])->assertOk();
        $conflict->assertJsonPath('methodResponses.0.1.notUpdated.'.$firstId.'.type', 'alreadyExists');
    }

    public function test_hidden_notes_directory_is_not_a_file_node(): void
    {
        app(WgwStorage::class)->files()->put('users/bob/.notes/hidden-note.md', 'note body');
        app(WgwStorage::class)->files()->put('users/bob/visible.md', 'visible');

        $names = array_column(array_values($this->fileNodeGetAll()), 'name');
        $this->assertContains('visible.md', $names);
        $this->assertNotContains('.notes', $names);
    }
}
