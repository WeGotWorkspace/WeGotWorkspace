<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use Illuminate\Support\Facades\Storage;
use Tests\Support\NotesTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #236 — Shared group notebooks under groups/{slug}/.notes/.
 *
 * Fixture membership (see NotesTestFixtures): team = { bob }. alice is an admin
 * but NOT a team member; carol is neither.
 */
final class NotesSharedNotebooksTest extends WgwDatabaseTestCase
{
    use NotesTestFixtures;

    private const TEAM = 'team';

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

    public function test_member_creates_note_in_group_tree_on_disk(): void
    {
        $created = $this->createNoteFor($this->userBearerToken(), [
            'notebook' => 'Roadmap',
            'title' => 'Q3 plan',
            'body' => 'shared body',
            'groupSlug' => self::TEAM,
        ]);
        $id = $created['id'];

        $this->assertSame('group', $created['item']['scope']);
        $this->assertSame(self::TEAM, $created['item']['groupSlug']);

        $key = 'groups/team/.notes/Roadmap/'.$id.'.md';
        $this->assertTrue(Storage::disk('wgw_notes')->exists($key));
        $this->assertFalse(
            Storage::disk('wgw_notes')->exists('users/bob/.notes/Roadmap/'.$id.'.md')
        );
    }

    public function test_list_includes_personal_and_shared_with_scope_field(): void
    {
        $token = $this->userBearerToken();
        $personal = $this->createNoteFor($token, ['notebook' => 'Personal', 'title' => 'Mine']);
        $shared = $this->createNoteFor($token, [
            'notebook' => 'Roadmap',
            'title' => 'Ours',
            'groupSlug' => self::TEAM,
        ]);

        $list = $this->withBearer($token)->getJson('/api/v1/notes/items');
        $list->assertOk();
        $items = collect($list->json('items'));

        $personalItem = $items->firstWhere('id', $personal['id']);
        $sharedItem = $items->firstWhere('id', $shared['id']);
        $this->assertIsArray($personalItem);
        $this->assertIsArray($sharedItem);
        $this->assertSame('personal', $personalItem['scope']);
        $this->assertNull($personalItem['groupSlug']);
        $this->assertSame('group', $sharedItem['scope']);
        $this->assertSame(self::TEAM, $sharedItem['groupSlug']);

        // Scoped list returns only that group's notes.
        $scoped = $this->withBearer($token)->getJson('/api/v1/notes/items?groupSlug='.self::TEAM);
        $scoped->assertOk();
        $scopedIds = array_column($scoped->json('items'), 'id');
        $this->assertContains($shared['id'], $scopedIds);
        $this->assertNotContains($personal['id'], $scopedIds);
    }

    public function test_notebooks_listing_tags_shared_notebooks(): void
    {
        $token = $this->userBearerToken();
        $this->createNoteFor($token, ['notebook' => 'Personal', 'title' => 'Mine']);
        $this->createNoteFor($token, ['notebook' => 'Roadmap', 'title' => 'Ours', 'groupSlug' => self::TEAM]);

        $notebooks = $this->withBearer($token)->getJson('/api/v1/notes/notebooks');
        $notebooks->assertOk();
        $items = collect($notebooks->json('items'));

        $roadmap = $items->firstWhere('name', 'Roadmap');
        $this->assertIsArray($roadmap);
        $this->assertSame('group', $roadmap['scope']);
        $this->assertSame(self::TEAM, $roadmap['groupSlug']);
    }

    public function test_notebooks_listing_includes_empty_group_membership_notebook(): void
    {
        $token = $this->userBearerToken();
        // Provision an empty notebook dir under the group home (no notes yet).
        $this->assertTrue(
            Storage::disk('wgw_notes')->makeDirectory('groups/'.self::TEAM.'/.notes/EmptyPad')
        );

        $notebooks = $this->withBearer($token)->getJson('/api/v1/notes/notebooks');
        $notebooks->assertOk();
        $items = collect($notebooks->json('items'));

        $empty = $items->first(
            static fn (array $row): bool => ($row['name'] ?? '') === 'EmptyPad'
                && ($row['scope'] ?? '') === 'group'
                && ($row['groupSlug'] ?? null) === self::TEAM
        );
        $this->assertIsArray($empty);
        $this->assertSame(0, $empty['activeCount']);
        $this->assertSame(0, $empty['archivedCount']);
    }

    public function test_notebooks_listing_surfaces_default_when_group_notes_home_is_empty(): void
    {
        $token = $this->userBearerToken();
        Storage::disk('wgw_notes')->makeDirectory('groups/'.self::TEAM.'/.notes');

        $notebooks = $this->withBearer($token)->getJson('/api/v1/notes/notebooks');
        $notebooks->assertOk();
        $items = collect($notebooks->json('items'));

        $general = $items->first(
            static fn (array $row): bool => ($row['name'] ?? '') === 'General'
                && ($row['scope'] ?? '') === 'group'
                && ($row['groupSlug'] ?? null) === self::TEAM
        );
        $this->assertIsArray($general);
    }

    public function test_member_can_update_delete_and_archive_shared_note(): void
    {
        $token = $this->userBearerToken();
        $created = $this->createNoteFor($token, [
            'notebook' => 'Roadmap',
            'title' => 'Editable',
            'body' => 'v1',
            'groupSlug' => self::TEAM,
        ]);
        $id = $created['id'];

        // Metadata-only update preserves the shared body.
        $this->withBearer($token)
            ->putJson('/api/v1/notes/items/'.$id, [
                'notebook' => 'Roadmap',
                'groupSlug' => self::TEAM,
            ])
            ->assertOk()
            ->assertJsonMissingPath('item.title')
            ->assertJsonPath('item.body', 'v1')
            ->assertJsonPath('item.scope', 'group');

        // Archive within the group tree.
        $this->withBearer($token)
            ->patchJson('/api/v1/notes/items/'.$id, ['archived' => true, 'groupSlug' => self::TEAM])
            ->assertOk()
            ->assertJsonPath('item.archived', true);
        $this->assertTrue(
            Storage::disk('wgw_notes')->exists('groups/team/.notes/.archive/Roadmap/'.$id.'.md')
        );

        // Restore and delete.
        $this->withBearer($token)
            ->patchJson('/api/v1/notes/items/'.$id, ['archived' => false, 'groupSlug' => self::TEAM])
            ->assertOk();
        $this->withBearer($token)
            ->deleteJson('/api/v1/notes/items/'.$id, [
                'notebook' => 'Roadmap',
                'archived' => false,
                'groupSlug' => self::TEAM,
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);
        $this->assertFalse(
            Storage::disk('wgw_notes')->exists('groups/team/.notes/Roadmap/'.$id.'.md')
        );
    }

    public function test_member_can_manage_shared_notebooks(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Specs', 'groupSlug' => self::TEAM])
            ->assertCreated()
            ->assertJsonPath('name', 'Specs');
        $this->assertTrue(Storage::disk('wgw_notes')->directoryExists('groups/team/.notes/Specs'));

        $this->withBearer($token)
            ->patchJson('/api/v1/notes/notebooks/'.rawurlencode('Specs'), ['name' => 'Designs', 'groupSlug' => self::TEAM])
            ->assertOk()
            ->assertJsonPath('to', 'Designs');
        $this->assertTrue(Storage::disk('wgw_notes')->directoryExists('groups/team/.notes/Designs'));
    }

    public function test_non_member_cannot_access_group_scope(): void
    {
        $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/notes/items', [
                'notebook' => 'Roadmap',
                'title' => 'Sneaky',
                'body' => 'x',
                'groupSlug' => self::TEAM,
            ])
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');

        $this->withBearer($this->carolBearerToken())
            ->getJson('/api/v1/notes/items?groupSlug='.self::TEAM)
            ->assertForbidden();
    }

    public function test_admin_does_not_bypass_group_membership(): void
    {
        // alice is an admin but not a team member.
        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/notes/items', [
                'notebook' => 'Roadmap',
                'title' => 'Admin override',
                'body' => 'x',
                'groupSlug' => self::TEAM,
            ])
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }

    public function test_shared_notes_are_isolated_from_personal_tree(): void
    {
        $token = $this->userBearerToken();
        $personal = $this->createNoteFor($token, ['notebook' => 'Roadmap', 'title' => 'Personal road']);
        $shared = $this->createNoteFor($token, [
            'notebook' => 'Roadmap',
            'title' => 'Shared road',
            'groupSlug' => self::TEAM,
        ]);

        // Same id space across scopes is independent on disk.
        $this->assertNotSame($personal['id'], $shared['id']);
        $this->assertTrue(Storage::disk('wgw_notes')->exists('users/bob/.notes/Roadmap/'.$personal['id'].'.md'));
        $this->assertTrue(Storage::disk('wgw_notes')->exists('groups/team/.notes/Roadmap/'.$shared['id'].'.md'));
    }

    public function test_group_notes_stay_hidden_in_drive_children_listing(): void
    {
        $token = $this->userBearerToken();
        $this->createNoteFor($token, [
            'notebook' => 'Roadmap',
            'title' => 'Hidden from drive',
            'groupSlug' => self::TEAM,
        ]);

        $listing = $this->withBearer($token)->getJson('/api/v1/files/children?path='.urlencode('/groups/team'));
        $listing->assertOk();
        $names = array_column((array) $listing->json('data.files'), 'name');
        $this->assertNotContains('.notes', $names);
    }
}
