<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Dav\Server\FileNodeIndexPlugin;
use App\Models\JmapFileNode;
use App\Models\Principal;
use App\Services\Drive\DocAttachmentsService;
use App\Services\Drive\DriveService;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\WgwStorage;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Log;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

final class DocAttachmentsTest extends WgwDatabaseTestCase
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

    public function test_attachments_are_indexed_but_hidden_from_children_listing(): void
    {
        $doc = $this->createMarkdownDoc('report.md');
        $image = $this->storePng($doc['id']);

        $names = array_column(array_values($this->fileNodeGetAll()), 'name');
        $this->assertContains('.attachments', $names);
        $this->assertContains($doc['id'], $names);
        $this->assertContains($image->name, $names);

        $listing = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/children?path=/users/bob');
        $listing->assertOk()->assertJsonFragment(['name' => 'report.md']);
        $listed = array_column((array) $listing->json('data.files'), 'name');
        $this->assertNotContains('.attachments', $listed);
    }

    public function test_upload_creates_canonical_attachment_path(): void
    {
        $doc = $this->createMarkdownDoc('report.md');
        $folder = app(DocAttachmentsService::class)->ensureFolderForDoc($doc['id']);
        $blobId = $this->uploadFileNodeBlob('PNGDATA', type: 'image/png');

        $created = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'img' => [
                    'parentId' => $folder->node_id,
                    'name' => 'photo.png',
                    'blobId' => $blobId,
                ],
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.img');

        $this->assertSame($created['id'].'.png', $created['name']);
        $key = 'users/bob/.attachments/'.$doc['id'].'/'.$created['id'].'.png';
        $this->assertTrue(app(WgwStorage::class)->files()->fileExists($key));
        $this->assertSame('PNGDATA', app(WgwStorage::class)->files()->get($key));
    }

    public function test_owner_group_member_path_share_and_stranger_inherit_acl(): void
    {
        $personal = $this->createMarkdownDoc('shared.md');
        $personalImage = $this->storePng($personal['id']);

        $this->withBearer($this->userBearerToken())->get(
            '/api/v1/files/content?id='.$personalImage->node_id,
        )->assertOk();
        $this->assertSame('PNGDATA', $this->withBearer($this->userBearerToken())
            ->get('/api/v1/files/content?id='.$personalImage->node_id)
            ->streamedContent());

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $this->withBearer($this->carolBearerToken())->get(
            '/api/v1/files/content?id='.$personalImage->node_id,
        )->assertOk();
        $this->assertSame('PNGDATA', $this->withBearer($this->carolBearerToken())
            ->get('/api/v1/files/content?id='.$personalImage->node_id)
            ->streamedContent());

        $groupDoc = $this->createMarkdownDoc('team.md', 'team', 'bob');
        $groupImage = $this->storePng($groupDoc['id']);
        $this->withBearer($this->userBearerToken())->get(
            '/api/v1/files/content?id='.$groupImage->node_id,
        )->assertOk();
        $this->withBearer($this->adminBearerToken())->get(
            '/api/v1/files/content?id='.$groupImage->node_id,
        )->assertOk();

        $this->withBearer($this->carolBearerToken())->get(
            '/api/v1/files/content?id='.$groupImage->node_id,
        )->assertStatus(403);
    }

    public function test_content_by_id_idor_denies_without_doc_may_view(): void
    {
        $doc = $this->createMarkdownDoc('secret.md');
        $image = $this->storePng($doc['id']);

        $this->withBearer($this->carolBearerToken())->get(
            '/api/v1/files/content?id='.$image->node_id,
        )->assertStatus(403);

        $this->seedPrivateFile('bob', 'private.png', 'nope');
        $nodes = $this->fileNodeGetAll();
        $otherId = $this->fileNodeIdByName($nodes, 'private.png');
        $this->withBearer($this->carolBearerToken())->get(
            '/api/v1/files/content?id='.$otherId,
        )->assertStatus(403);

        $this->withBearer($this->userBearerToken())->get(
            '/api/v1/files/content?id=fn-'.str_repeat('0', 32),
        )->assertStatus(404);
    }

    public function test_jmap_parent_id_move_relocates_attachments_and_is_idempotent(): void
    {
        $doc = $this->createMarkdownDoc('local.md');
        $image = $this->storePng($doc['id']);
        $nodes = $this->fileNodeGetAll();
        $teamId = $this->fileNodeIdByName($nodes, 'team');
        $homeId = $this->fileNodeIdByName($nodes, 'bob');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $doc['id'] => ['parentId' => $teamId],
            ]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$doc['id'], null);

        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists('users/bob/.attachments/'.$doc['id']));
        $this->assertTrue(app(WgwStorage::class)->files()->fileExists(
            'groups/team/.attachments/'.$doc['id'].'/'.$image->name,
        ));

        app(DocAttachmentsService::class)->relocateForDoc($doc['id']);
        $this->assertTrue(app(WgwStorage::class)->files()->fileExists(
            'groups/team/.attachments/'.$doc['id'].'/'.$image->name,
        ));

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $doc['id'] => ['parentId' => $homeId],
            ]], 'c1'],
        ])->assertOk();
        $this->assertTrue(app(WgwStorage::class)->files()->fileExists(
            'users/bob/.attachments/'.$doc['id'].'/'.$image->name,
        ));
    }

    public function test_rest_rename_relocates_and_trash_move_does_not(): void
    {
        $doc = $this->createMarkdownDoc('rest.md');
        $image = $this->storePng($doc['id']);

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/groups/team',
            '/users/bob/rest.md',
            'rest.md',
        ));
        $this->assertTrue(app(WgwStorage::class)->files()->fileExists(
            'groups/team/.attachments/'.$doc['id'].'/'.$image->name,
        ));

        $this->ensureTrashDirectory($this->userBearerToken(), 'bob');
        $this->createMarkdownDoc('stay.md');
        $stay = $this->fileNodeIdByName($this->fileNodeGetAll(), 'stay.md');
        $stayImage = $this->storePng($stay);

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/.Trash',
            '/users/bob/stay.md',
            'stay.md',
        ));
        $this->assertTrue(app(WgwStorage::class)->files()->fileExists(
            'users/bob/.attachments/'.$stay.'/'.$stayImage->name,
        ));
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists(
            'users/bob/.Trash/.attachments/'.$stay,
        ));
    }

    public function test_permanent_destroy_gcs_attachments_and_is_idempotent(): void
    {
        $doc = $this->createMarkdownDoc('gone.md');
        $image = $this->storePng($doc['id']);
        $folderKey = 'users/bob/.attachments/'.$doc['id'];
        $this->assertTrue(app(WgwStorage::class)->files()->directoryExists($folderKey));

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$doc['id']]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $doc['id']);

        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists($folderKey));
        $this->assertFalse(app(WgwStorage::class)->files()->fileExists($folderKey.'/'.$image->name));

        app(DocAttachmentsService::class)->destroyForDoc($doc['id']);
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists($folderKey));
    }

    public function test_rest_delete_items_gcs_attachments(): void
    {
        $doc = $this->createMarkdownDoc('rest-del.md');
        $this->storePng($doc['id']);
        $folderKey = 'users/bob/.attachments/'.$doc['id'];

        $this->assertSame('Deleted', app(DriveService::class)->deleteItems(
            $this->drivePrincipal('bob'),
            [['path' => '/users/bob/rest-del.md']],
        ));
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists($folderKey));
    }

    public function test_sidecar_failure_after_doc_move_logs_and_does_not_roll_back(): void
    {
        $doc = $this->createMarkdownDoc('keep.md');
        $this->storePng($doc['id']);
        $teamId = $this->fileNodeIdByName($this->fileNodeGetAll(), 'team');

        $warnings = [];
        Log::listen(function (MessageLogged $event) use (&$warnings): void {
            if ($event->level === 'warning') {
                $warnings[] = $event->message;
            }
        });

        app(WgwStorage::class)->files()->put('groups/team/.attachments', 'not-a-directory');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $doc['id'] => ['parentId' => $teamId],
            ]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$doc['id'], null);

        $this->assertTrue(app(WgwStorage::class)->files()->fileExists('groups/team/keep.md'));
        $this->assertFalse(app(WgwStorage::class)->files()->fileExists('users/bob/keep.md'));
        $this->assertContains('doc_attachments_sidecar_failed', $warnings);
    }

    public function test_dav_plugin_delete_gcs_file_and_collection_and_skips_attachments_and_yjs(): void
    {
        $doc = $this->createMarkdownDoc('dav.md');
        $image = $this->storePng($doc['id']);
        $plugin = $this->indexPlugin();

        $plugin->afterWriteMethod(
            new SabreRequest('DELETE', '/files/users/bob/dav.md'),
            new SabreResponse(204),
        );
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists('users/bob/.attachments/'.$doc['id']));
        $this->assertNull(app(FileNodeIndexService::class)->liveByNodeId($image->node_id));

        $folderDocA = $this->createMarkdownDoc('a.md');
        $this->createDriveDirectory('/users/bob', 'packet');
        $nodes = $this->fileNodeGetAll();
        $packetId = $this->fileNodeIdByName($nodes, 'packet');
        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $folderDocA['id'] => ['parentId' => $packetId],
            ]], 'c0'],
        ])->assertOk();
        $folderDocB = $this->createMarkdownDoc('b.md');
        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $folderDocB['id'] => ['parentId' => $packetId],
            ]], 'c1'],
        ])->assertOk();
        $this->storePng($folderDocA['id']);
        $this->storePng($folderDocB['id']);

        $plugin->afterWriteMethod(
            new SabreRequest('DELETE', '/files/users/bob/packet'),
            new SabreResponse(204),
        );
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists('users/bob/.attachments/'.$folderDocA['id']));
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists('users/bob/.attachments/'.$folderDocB['id']));

        $other = $this->createMarkdownDoc('still.md');
        $this->storePng($other['id']);
        $attachmentKey = 'users/bob/.attachments/'.$other['id'];
        $child = app(FileNodeIndexService::class)->liveByKey($attachmentKey);
        $this->assertNotNull($child);
        $plugin->afterWriteMethod(
            new SabreRequest('DELETE', '/files/'.$attachmentKey),
            new SabreResponse(204),
        );
        $this->assertNotNull(app(FileNodeIndexService::class)->liveByNodeId($other['id']));

        $yjs = $this->createMarkdownDoc('collab.md');
        $this->storePng($yjs['id']);
        app(WgwStorage::class)->files()->put('users/bob/.collab.md.yjs', 'yjs');
        $plugin->afterWriteMethod(
            new SabreRequest('DELETE', '/files/users/bob/.collab.md.yjs'),
            new SabreResponse(204),
        );
        $this->assertTrue(app(WgwStorage::class)->files()->directoryExists('users/bob/.attachments/'.$yjs['id']));
    }

    public function test_dav_plugin_move_relocates_across_group_trees(): void
    {
        $ops = $this->seedWgwGroup('principals/groups/ops', 'Ops');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($ops, $bob);
        app(WgwStorage::class)->files()->makeDirectory('groups/ops');

        $doc = $this->createMarkdownDoc('cross.md', 'team', 'bob');
        $image = $this->storePng($doc['id']);
        app(FileNodeIndexService::class)->ensureRootsIndexed('bob', ['team', 'ops']);

        $move = new SabreRequest('MOVE', '/files/groups/team/cross.md');
        $move->setHeader('Destination', '/files/groups/ops/cross.md');
        $this->indexPlugin()->afterWriteMethod($move, new SabreResponse(201));

        $this->assertTrue(app(WgwStorage::class)->files()->fileExists(
            'groups/ops/.attachments/'.$doc['id'].'/'.$image->name,
        ));
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists(
            'groups/team/.attachments/'.$doc['id'],
        ));
    }

    /**
     * @return array{id: string, name: string}
     */
    private function createMarkdownDoc(string $name, string $parentName = 'bob', string $accountId = 'bob'): array
    {
        $token = $accountId === 'bob' ? $this->userBearerToken() : $this->adminBearerToken();
        $nodes = $this->fileNodeGetAll($accountId, $token);
        $parentId = $this->fileNodeIdByName($nodes, $parentName);
        $blobId = $this->uploadFileNodeBlob("# {$name}\n", $accountId, $token);

        $created = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => $accountId, 'create' => [
                'd0' => ['parentId' => $parentId, 'name' => $name, 'blobId' => $blobId],
            ]], 'c0'],
        ], $token)->assertOk()->json('methodResponses.0.1.created.d0');

        return ['id' => $created['id'], 'name' => $created['name']];
    }

    private function storePng(string $docNodeId): JmapFileNode
    {
        return app(DocAttachmentsService::class)->storeImageForDoc($docNodeId, 'PNGDATA', 'png');
    }

    private function indexPlugin(): FileNodeIndexPlugin
    {
        return new FileNodeIndexPlugin(
            app(FileNodeIndexService::class),
            app(DocAttachmentsService::class),
        );
    }
}
