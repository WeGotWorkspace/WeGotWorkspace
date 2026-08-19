<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Storage\WgwStorage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

/**
 * FileNode/set note writes: create `.md`, title/tags, archive-restore,
 * notebook mkdir-rename-delete. YAML `starred` is not emitted.
 */
final class JmapFileNodeNotesSetTest extends WgwDatabaseTestCase
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

    public function test_set_creates_note_markdown_and_rewrites_title_tags_without_stripping_yaml_star(): void
    {
        $this->seedNotesTree();
        $notesRootId = $this->personalNotesRootId();
        $draftsId = $this->childIdByName($notesRootId, 'Drafts');

        $created = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'n0' => [
                    'parentId' => $draftsId,
                    'name' => 'fresh.md',
                    'note' => ['title' => 'Fresh note', 'tags' => ['alpha']],
                ],
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.n0');

        $this->assertSame('Fresh note', $created['note']['title']);
        $this->assertSame(['alpha'], $created['note']['tags']);
        $this->assertSame('Drafts', $created['note']['notebook']);
        $this->assertFalse($created['note']['starred']);

        $disk = app(WgwStorage::class)->files();
        $raw = (string) $disk->get('users/bob/.notes/Drafts/fresh.md');
        $this->assertStringContainsString('title: Fresh note', $raw);
        $this->assertStringNotContainsString('starred:', $raw);

        $disk->put(
            'users/bob/.notes/Drafts/fresh.md',
            "title: Fresh note\ntags: alpha\nstarred: true\n----\nkeep body"
        );

        $updated = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $created['id'] => ['note' => ['title' => 'Renamed', 'tags' => ['beta', 'gamma']]],
            ]], 'c1'],
        ])->assertOk()->json('methodResponses.0.1.updated.'.$created['id']);

        $this->assertSame('Renamed', $updated['note']['title']);
        $this->assertSame(['beta', 'gamma'], $updated['note']['tags']);
        $this->assertFalse($updated['note']['starred']);

        $rewritten = (string) $disk->get('users/bob/.notes/Drafts/fresh.md');
        $this->assertStringContainsString('title: Renamed', $rewritten);
        $this->assertStringContainsString('tags: beta, gamma', $rewritten);
        $this->assertStringNotContainsString('starred:', $rewritten);
        $this->assertStringContainsString("----\nkeep body", $rewritten);
    }

    public function test_set_archives_restores_and_manages_notebook_directories(): void
    {
        $this->seedNotesTree();
        $notesRootId = $this->personalNotesRootId();
        $activeDraftsId = $this->childIdByName($notesRootId, 'Drafts');
        $archiveRootId = $this->childIdByName($notesRootId, '.archive');
        $archivedDraftsId = $this->childIdByName($archiveRootId, 'Drafts');
        $noteId = $this->childIdByName($activeDraftsId, 'welcome.md');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $noteId => ['parentId' => $archivedDraftsId],
            ]], 'c0'],
        ])->assertOk();

        $disk = app(WgwStorage::class)->files();
        $this->assertFalse($disk->fileExists('users/bob/.notes/Drafts/welcome.md'));
        $this->assertTrue($disk->fileExists('users/bob/.notes/.archive/Drafts/welcome.md'));
        $archived = $this->getNoteByName('welcome.md');
        $this->assertTrue($archived['note']['archived']);
        $this->assertSame('Drafts', $archived['note']['notebook']);

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $noteId => ['parentId' => $activeDraftsId],
            ]], 'c1'],
        ])->assertOk();
        $this->assertTrue($disk->fileExists('users/bob/.notes/Drafts/welcome.md'));
        $this->assertFalse($this->getNoteByName('welcome.md')['note']['archived']);

        $created = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'nb' => ['parentId' => $notesRootId, 'name' => 'Ideas'],
            ]], 'c2'],
        ])->assertOk()->json('methodResponses.0.1.created.nb');
        $this->assertSame('directory', $created['nodeType']);
        $this->assertTrue($disk->directoryExists('users/bob/.notes/Ideas'));

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $created['id'] => ['name' => 'Specs'],
            ]], 'c3'],
        ])->assertOk();
        $this->assertFalse($disk->directoryExists('users/bob/.notes/Ideas'));
        $this->assertTrue($disk->directoryExists('users/bob/.notes/Specs'));

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$created['id']], 'onDestroyRemoveChildren' => true], 'c4'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $created['id']);
        $this->assertFalse($disk->directoryExists('users/bob/.notes/Specs'));
    }

    public function test_set_rejects_note_patch_on_non_note_files(): void
    {
        $this->seedPrivateFile('bob', 'hello.txt', 'hello');
        $nodes = $this->fileNodeGetAll();
        $fileId = $this->fileNodeIdByName($nodes, 'hello.txt');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $fileId => ['note' => ['title' => 'Nope']],
            ]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.notUpdated.'.$fileId.'.type', 'invalidProperties');
    }

    /**
     * @return array<string, mixed>
     */
    private function getNoteByName(string $name): array
    {
        $nodes = $this->fileNodeGetAll();

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

    private function childIdByName(string $parentId, string $name): string
    {
        foreach ($this->fileNodeGetAll() as $node) {
            if ($node['parentId'] === $parentId && $node['name'] === $name) {
                return $node['id'];
            }
        }
        $this->fail('No child named '.$name);
    }

    private function seedNotesTree(): void
    {
        app(WgwStorage::class)->files()->put(
            'users/bob/.notes/Drafts/welcome.md',
            "title: Welcome\ntags: intro, team\nstarred: true\n----\nHello body text for the list excerpt"
        );
        app(WgwStorage::class)->files()->put(
            'users/bob/.notes/.archive/Drafts/old.md',
            "title: Old note\ntags:\nstarred: false\n----\nArchived excerpt"
        );
    }
}
