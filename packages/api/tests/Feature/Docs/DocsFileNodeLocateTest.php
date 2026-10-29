<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Models\JmapFileNode;
use App\Services\Drive\DriveService;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * GET /files/node turns a FileNode id into the file's current path and back,
 * so Docs can open a document by id (#1751).
 */
final class DocsFileNodeLocateTest extends WgwDatabaseTestCase
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

    public function test_owner_resolves_by_id_and_by_path(): void
    {
        $id = $this->indexedDoc('bob', 'plan.md');

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?id='.$id)
            ->assertOk()
            ->assertExactJson(['data' => ['id' => $id, 'path' => '/users/bob/plan.md']]);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?path='.rawurlencode('/users/bob/plan.md'))
            ->assertOk()
            ->assertExactJson(['data' => ['id' => $id, 'path' => '/users/bob/plan.md']]);
    }

    public function test_id_follows_a_rename_and_a_move(): void
    {
        $id = $this->indexedDoc('bob', 'plan.md');
        $this->createDriveDirectory('/users/bob', 'Projects');
        $drive = app(DriveService::class);
        $drive->renameItem($this->drivePrincipal('bob'), '/users/bob', 'plan.md', 'roadmap.md');
        $drive->renameItem($this->drivePrincipal('bob'), '/users/bob/Projects', '/users/bob/roadmap.md', 'roadmap.md');

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?id='.$id)
            ->assertOk()
            ->assertJsonPath('data.path', '/users/bob/Projects/roadmap.md');
    }

    public function test_path_lookup_indexes_a_file_written_outside_the_index(): void
    {
        $this->seedPrivateFile('bob', 'outside.md', '# Outside');
        $this->assertNull(app(FileNodeIndexService::class)->liveByKey('users/bob/outside.md'));

        $id = (string) $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?path='.rawurlencode('/users/bob/outside.md'))
            ->assertOk()
            ->json('data.id');

        $this->assertMatchesRegularExpression('/^fn-[0-9a-f]{32}$/', $id);
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?id='.$id)
            ->assertOk()
            ->assertJsonPath('data.path', '/users/bob/outside.md');
    }

    public function test_member_grantee_resolves_a_shared_doc(): void
    {
        $id = $this->indexedDoc('bob', 'shared.md');
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $this->withBearer($this->carolBearerToken())
            ->getJson('/api/v1/files/node?id='.$id)
            ->assertOk()
            ->assertJsonPath('data.path', '/users/bob/shared.md');
    }

    public function test_group_doc_resolves_for_members_only(): void
    {
        $this->seedGroupFile('team.md', '# Team');
        $id = $this->indexKey('groups/team/team.md');

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?id='.$id)
            ->assertOk()
            ->assertJsonPath('data.path', '/groups/team/team.md');

        $this->withBearer($this->carolBearerToken())
            ->getJson('/api/v1/files/node?id='.$id)
            ->assertForbidden();
    }

    public function test_stranger_cannot_resolve(): void
    {
        $id = $this->indexedDoc('bob', 'secret.md');

        $byId = $this->withBearer($this->carolBearerToken())
            ->getJson('/api/v1/files/node?id='.$id)
            ->assertForbidden();
        $this->assertStringNotContainsString('secret.md', (string) $byId->getContent());

        $this->withBearer($this->carolBearerToken())
            ->getJson('/api/v1/files/node?path='.rawurlencode('/users/bob/secret.md'))
            ->assertForbidden();
    }

    public function test_trashed_doc_is_not_found(): void
    {
        $id = $this->indexedDoc('bob', 'old.md');
        $this->ensureTrashDirectory($this->userBearerToken(), 'bob');
        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/.Trash',
            '/users/bob/old.md',
            'old.md',
        );
        $this->assertNotNull(app(FileNodeIndexService::class)->liveByNodeId($id));

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?id='.$id)
            ->assertNotFound();

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?path='.rawurlencode('/users/bob/.Trash/old.md'))
            ->assertNotFound();
    }

    public function test_unknown_deleted_and_directory_are_not_found(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?id=fn-'.str_repeat('0', 32))
            ->assertNotFound();

        $this->createDriveDirectory('/users/bob', 'Folder');
        $folderId = $this->indexKey('users/bob/Folder');
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?id='.$folderId)
            ->assertNotFound();
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?path='.rawurlencode('/users/bob/Folder'))
            ->assertNotFound();

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?path='.rawurlencode('/users/bob/missing.md'))
            ->assertNotFound();
    }

    public function test_bad_requests(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node')
            ->assertStatus(400);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?id=not-a-node')
            ->assertStatus(400);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/node?path='.rawurlencode('/users/bob/../carol/x.md'))
            ->assertStatus(400);
    }

    public function test_guests_and_anonymous_callers_are_refused(): void
    {
        $id = $this->indexedDoc('bob', 'public.md');
        $share = $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/public.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();
        $guestToken = (string) $this->postJson('/api/v1/files/share-sessions', [
            'token' => (string) $share->json('data.publicToken'),
        ])->assertOk()->json('access_token');

        $this->withBearer($guestToken)
            ->getJson('/api/v1/files/node?id='.$id)
            ->assertForbidden();

        $this->flushHeaders();
        $this->getJson('/api/v1/files/node?id='.$id)->assertUnauthorized();
    }

    private function indexedDoc(string $username, string $name): string
    {
        $this->createDriveFile($this->userBearerToken(), '/users/'.$username, $name);

        return $this->indexKey('users/'.$username.'/'.$name);
    }

    private function indexKey(string $key): string
    {
        $node = app(FileNodeIndexService::class)->liveByKey($key)
            ?? app(FileNodeIndexService::class)->recordCreate($key);
        $this->assertInstanceOf(JmapFileNode::class, $node);

        return (string) $node->node_id;
    }
}
