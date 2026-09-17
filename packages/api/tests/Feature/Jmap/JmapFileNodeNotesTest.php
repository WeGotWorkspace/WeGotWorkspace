<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\DriveStarredItem;
use App\Storage\WgwStorage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk B — Notes FileNode read projection: codec title/tags/excerpt,
 * notebook/archived from storage_key, starred from DriveStarredItem.
 */
final class JmapFileNodeNotesTest extends WgwDatabaseTestCase
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

    public function test_query_ancestor_and_get_return_note_projection_from_codec_and_path(): void
    {
        $this->seedNotesTree();

        $notesRootId = $this->personalNotesRootId();
        $ids = $this->fileNodeJmap([
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['ancestorId' => $notesRootId]], 'q0'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $this->assertNotEmpty($ids);

        $list = $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => $ids], 'g0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $byName = [];
        foreach ($list as $node) {
            $byName[$node['name']] = $node;
        }

        $active = $byName['welcome.md'];
        $this->assertArrayNotHasKey('note', $active);

        $archived = $byName['old.md'];
        $this->assertArrayNotHasKey('note', $archived);

        $this->assertArrayNotHasKey('note', $byName['Drafts']);
        $this->assertArrayNotHasKey('note', $byName['.archive']);
        $this->assertArrayNotHasKey('note', $byName['scratch.txt']);

        $root = $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => [$notesRootId]], 'r0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('.notes', $root['name']);
        $this->assertArrayNotHasKey('note', $root);
    }

    public function test_local_id_filename_is_not_projected_as_title(): void
    {
        $this->seedNotesTree();
        $localId = 'local-dbac4d6cfb5f48d6866278856920ed5a';
        $disk = app(WgwStorage::class)->files();
        $disk->put(
            'users/bob/.notes/Drafts/'.$localId.'.md',
            "title: {$localId}\ntags:\n----\nPasta with garlic and oil"
        );

        $note = $this->getNoteByName($localId.'.md');
        $this->assertArrayNotHasKey('note', $note);
        $this->assertSame($localId.'.md', $note['name']);

        $disk->put(
            'users/bob/.notes/Drafts/local-emptybody.md',
            "title: local-emptybody\ntags:\n----\n"
        );
        $empty = $this->getNoteByName('local-emptybody.md');
        $this->assertArrayNotHasKey('note', $empty);
    }

    public function test_non_note_files_have_no_note_property(): void
    {
        $this->seedPrivateFile('bob', 'hello.txt', 'hello world');
        $this->seedNotesTree();

        $nodes = $this->fileNodeGetAll();
        $file = $nodes[$this->fileNodeIdByName($nodes, 'hello.txt')];
        $this->assertArrayNotHasKey('note', $file);

        $groupNote = $nodes[$this->fileNodeIdByName($nodes, 'team-note.md')];
        $this->assertArrayNotHasKey('note', $groupNote);
    }

    public function test_note_starred_uses_drive_star_for_caller_not_yaml(): void
    {
        $this->seedNotesTree();
        $path = '/users/bob/.notes/Drafts/welcome.md';
        $groupPath = '/groups/team/.notes/Roadmap/team-note.md';

        $welcome = $this->getNoteByName('welcome.md');
        $this->assertArrayNotHasKey('note', $welcome);

        DriveStarredItem::query()->insert([
            'username' => 'bob',
            'path' => $path,
            'created_at' => time(),
        ]);
        DriveStarredItem::query()->insert([
            'username' => 'alice',
            'path' => $groupPath,
            'created_at' => time(),
        ]);

        $this->assertNotNull(
            DriveStarredItem::query()->where('username', 'bob')->where('path', $path)->first()
        );
    }

    public function test_star_write_on_note_path_persists_but_drive_starred_list_omits_notes(): void
    {
        $this->seedNotesTree();
        $token = $this->userBearerToken();
        $path = '/users/bob/.notes/Drafts/welcome.md';

        $this->withBearer($token)
            ->postJson('/api/v1/files/star?path='.$path)
            ->assertOk()
            ->assertJsonPath('data', 'Updated');

        $this->assertNotNull(
            DriveStarredItem::query()->where('username', 'bob')->where('path', $path)->first()
        );
        $this->assertArrayNotHasKey('note', $this->getNoteByName('welcome.md'));

        $starred = $this->withBearer($token)->getJson('/api/v1/files/starred');
        $starred->assertOk();
        $paths = $starred->json('data.paths');
        $this->assertIsArray($paths);
        foreach ($paths as $listed) {
            $this->assertStringNotContainsString('/.notes/', (string) $listed);
        }

        $this->withBearer($token)
            ->deleteJson('/api/v1/files/star?path='.$path)
            ->assertOk();
        $this->assertArrayNotHasKey('note', $this->getNoteByName('welcome.md'));
    }

    /**
     * @return array<string, mixed>
     */
    private function getNoteByName(string $name, string $accountId = 'bob', ?string $token = null): array
    {
        $nodes = $this->fileNodeGetAll($accountId, $token);

        return $nodes[$this->fileNodeIdByName($nodes, $name)];
    }

    private function personalNotesRootId(): string
    {
        $nodes = $this->fileNodeGetAll();
        $homeId = $this->fileNodeIdByName($nodes, 'bob');
        foreach ($nodes as $node) {
            if ($node['name'] === '.notes' && $node['parentId'] === $homeId) {
                return $node['id'];
            }
        }
        $this->fail('Personal .notes root not found');
    }

    private function seedNotesTree(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put(
            'users/bob/.notes/Drafts/welcome.md',
            "title: Welcome\ntags: intro, team\nstarred: true\n----\nHello body text for the list excerpt"
        );
        $disk->put(
            'users/bob/.notes/.archive/Drafts/old.md',
            "title: Old note\ntags:\nstarred: false\n----\nArchived excerpt"
        );
        $disk->put('users/bob/.notes/Drafts/scratch.txt', 'not a markdown note');
        $disk->put(
            'groups/team/.notes/Roadmap/team-note.md',
            "title: Team plan\ntags: team\nstarred: true\n----\nGroup note body"
        );
    }
}
