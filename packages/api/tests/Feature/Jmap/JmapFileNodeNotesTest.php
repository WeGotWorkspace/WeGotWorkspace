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
        $this->assertArrayHasKey('note', $active);
        $this->assertSame('Welcome', $active['note']['title']);
        $this->assertSame(['intro', 'team'], $active['note']['tags']);
        $this->assertSame('Hello body text for the list excerpt', $active['note']['excerpt']);
        $this->assertSame('Drafts', $active['note']['notebook']);
        $this->assertFalse($active['note']['archived']);
        $this->assertFalse($active['note']['starred']);
        $this->assertArrayNotHasKey('body', $active['note']);

        $archived = $byName['old.md'];
        $this->assertSame('Old note', $archived['note']['title']);
        $this->assertSame('Drafts', $archived['note']['notebook']);
        $this->assertTrue($archived['note']['archived']);
        $this->assertFalse($archived['note']['starred']);

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
        $this->assertSame('Pasta with garlic and oil', $note['note']['excerpt']);
        $this->assertSame('', $note['note']['title']);
        $this->assertNotSame($localId, $note['note']['title']);

        $disk->put(
            'users/bob/.notes/Drafts/local-emptybody.md',
            "title: local-emptybody\ntags:\n----\n"
        );
        $empty = $this->getNoteByName('local-emptybody.md');
        $this->assertSame('', $empty['note']['excerpt']);
        $this->assertSame('', $empty['note']['title']);
    }

    public function test_non_note_files_have_no_note_property(): void
    {
        $this->seedPrivateFile('bob', 'hello.txt', 'hello world');
        $this->seedNotesTree();

        $nodes = $this->fileNodeGetAll();
        $file = $nodes[$this->fileNodeIdByName($nodes, 'hello.txt')];
        $this->assertArrayNotHasKey('note', $file);

        $groupNote = $nodes[$this->fileNodeIdByName($nodes, 'team-note.md')];
        $this->assertArrayHasKey('note', $groupNote);
        $this->assertSame('Roadmap', $groupNote['note']['notebook']);
        $this->assertFalse($groupNote['note']['archived']);
    }

    public function test_note_starred_uses_drive_star_for_caller_not_yaml(): void
    {
        $this->seedNotesTree();
        $path = '/users/bob/.notes/Drafts/welcome.md';
        $groupPath = '/groups/team/.notes/Roadmap/team-note.md';

        $welcome = $this->getNoteByName('welcome.md');
        $this->assertFalse($welcome['note']['starred']);

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

        $welcome = $this->getNoteByName('welcome.md');
        $this->assertTrue($welcome['note']['starred']);

        $teamAsBob = $this->getNoteByName('team-note.md');
        $this->assertFalse($teamAsBob['note']['starred']);

        $teamAsAlice = $this->getNoteByName('team-note.md', 'alice', $this->adminBearerToken());
        $this->assertTrue($teamAsAlice['note']['starred']);
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
        $this->assertTrue($this->getNoteByName('welcome.md')['note']['starred']);

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
        $this->assertFalse($this->getNoteByName('welcome.md')['note']['starred']);
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
