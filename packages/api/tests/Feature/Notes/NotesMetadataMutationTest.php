<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use Illuminate\Support\Facades\Storage;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\NotesTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #235 — Notes metadata-only mutations: body becomes optional on upsert and the
 * markdown body section is preserved when omitted, including coexistence with
 * the collab body persistence path (`PUT /files/collaboration`).
 */
final class NotesMetadataMutationTest extends WgwDatabaseTestCase
{
    use InteractsWithFileNodeJmap;
    use NotesTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpNotesFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownNotesFixtures();
        parent::tearDown();
    }

    public function test_metadata_only_put_preserves_existing_body_and_frontmatter_title(): void
    {
        $token = $this->userBearerToken();
        $created = $this->createNoteFor($token, [
            'notebook' => 'Drafts',
            'body' => "First paragraph\n\nSecond paragraph",
            'tags' => ['old'],
            'starred' => false,
        ]);
        $id = $created['id'];
        $key = 'users/bob/.notes/Drafts/'.$id.'.md';
        Storage::disk('wgw_notes')->put(
            $key,
            "title: Original\ntags: old\nstarred: false\n----\nFirst paragraph\n\nSecond paragraph"
        );

        // PUT without a body field: frontmatter updates, body and stored title stay intact.
        $this->withBearer($token)
            ->putJson('/api/v1/notes/items/'.$id, [
                'notebook' => 'Drafts',
                'tags' => ['new', 'shiny'],
                'starred' => true,
            ])
            ->assertOk()
            ->assertJsonMissingPath('item.title')
            ->assertJsonPath('item.tags', ['new', 'shiny'])
            ->assertJsonPath('item.starred', true)
            ->assertJsonPath('item.body', "First paragraph\n\nSecond paragraph");

        $raw = (string) Storage::disk('wgw_notes')->get($key);
        $this->assertStringContainsString('title: Original', $raw);
        $this->assertStringContainsString('tags: new, shiny', $raw);
        $this->assertStringContainsString("----\nFirst paragraph\n\nSecond paragraph", $raw);
    }

    public function test_put_with_body_still_overwrites_body(): void
    {
        $token = $this->userBearerToken();
        $created = $this->createNoteFor($token, ['body' => 'old body']);
        $id = $created['id'];

        $this->withBearer($token)
            ->putJson('/api/v1/notes/items/'.$id, [
                'notebook' => 'Drafts',
                'body' => 'brand new body',
            ])
            ->assertOk()
            ->assertJsonPath('item.body', 'brand new body');
    }

    public function test_put_with_empty_string_body_clears_body(): void
    {
        $token = $this->userBearerToken();
        $created = $this->createNoteFor($token, ['body' => 'has content']);
        $id = $created['id'];

        $this->withBearer($token)
            ->putJson('/api/v1/notes/items/'.$id, [
                'notebook' => 'Drafts',
                'body' => '',
            ])
            ->assertOk()
            ->assertJsonPath('item.body', '');
    }

    public function test_collab_body_save_and_metadata_put_do_not_clobber(): void
    {
        $token = $this->userBearerToken();
        $created = $this->createNoteFor($token, [
            'notebook' => 'Drafts',
            'body' => 'initial body',
            'tags' => ['draft'],
        ]);
        $id = $created['id'];
        $key = 'users/bob/.notes/Drafts/'.$id.'.md';
        Storage::disk('wgw_notes')->put(
            $key,
            "title: Shared draft\ntags: draft\nstarred: false\n----\ninitial body"
        );
        $path = '/users/bob/.notes/Drafts/'.$id.'.md';

        // Collab exposes the body section only (frontmatter stays Notes-owned).
        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode($path))
            ->assertOk()
            ->assertSeeText('initial body');

        // Body edited through the collab path.
        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode($path), [
                'markdown' => 'body rewritten by collab',
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        // Frontmatter survived the collab body write; title is not exposed on the API.
        $afterCollab = $this->withBearer($token)->getJson('/api/v1/notes/items');
        $afterCollab->assertOk();
        $afterCollab->assertJsonMissingPath('items.0.title');
        $this->assertSame(['draft'], $afterCollab->json('items.0.tags'));
        $this->assertSame('body rewritten by collab', $afterCollab->json('items.0.body'));

        // Metadata-only PUT does not clobber the collab-written body or stored title.
        $this->withBearer($token)
            ->putJson('/api/v1/notes/items/'.$id, [
                'notebook' => 'Drafts',
                'tags' => ['final'],
            ])
            ->assertOk()
            ->assertJsonMissingPath('item.title')
            ->assertJsonPath('item.body', 'body rewritten by collab');

        $raw = (string) Storage::disk('wgw_notes')->get($key);
        $this->assertStringContainsString('title: Shared draft', $raw);

        // Collab still reads only the body section after the metadata change.
        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode($path))
            ->assertOk()
            ->assertDontSeeText('Shared draft')
            ->assertSeeText('body rewritten by collab');
    }

    public function test_filenode_set_title_tags_preserves_yaml_star_for_notes_items(): void
    {
        $token = $this->userBearerToken();
        $created = $this->createNoteFor($token, [
            'id' => 'pass-through-star',
            'notebook' => 'Drafts',
            'body' => 'keep me',
            'tags' => ['old'],
            'starred' => true,
        ]);
        $id = $created['id'];
        $key = 'users/bob/.notes/Drafts/'.$id.'.md';

        $nodes = $this->fileNodeGetAll();
        $noteId = $this->fileNodeIdByName($nodes, $id.'.md');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $noteId => ['note' => ['title' => 'Rewritten', 'tags' => ['new']]],
            ]], 'c0'],
        ], $token)->assertOk();

        $this->withBearer($token)->getJson('/api/v1/notes/items')
            ->assertOk()
            ->assertJsonPath('items.0.starred', true)
            ->assertJsonPath('items.0.tags', ['new'])
            ->assertJsonPath('items.0.body', 'keep me');

        $raw = (string) Storage::disk('wgw_notes')->get($key);
        $this->assertStringContainsString('starred: true', $raw);
        $this->assertStringContainsString('title: Rewritten', $raw);
        $this->assertStringContainsString("----\nkeep me", $raw);
    }
}
