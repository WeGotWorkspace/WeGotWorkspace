<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\NotesTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class NotesPathShareTest extends WgwDatabaseTestCase
{
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

    public function test_rejects_comment_and_review_grants_on_note_path(): void
    {
        $ownerToken = $this->userBearerToken();
        $created = $this->createNoteFor($ownerToken, [
            'notebook' => 'Drafts',
            'title' => 'Shared note',
            'body' => 'hello',
        ]);
        $path = '/users/bob/.notes/Drafts/'.$created['id'].'.md';

        foreach (['comment', 'review'] as $access) {
            $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
                'path' => $path,
                'kind' => 'member',
                'defaultAccess' => $access,
                'shareWith' => ['alice' => ['access' => $access]],
            ])
                ->assertStatus(400)
                ->assertJsonPath('code', 'comment_not_applicable');
        }
    }

    public function test_rejects_public_guest_kind_and_email_grants_on_note_path(): void
    {
        $ownerToken = $this->userBearerToken();
        $created = $this->createNoteFor($ownerToken, [
            'notebook' => 'Drafts',
            'body' => 'hello',
        ]);
        $path = '/users/bob/.notes/Drafts/'.$created['id'].'.md';

        foreach (['public', 'guest'] as $kind) {
            $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
                'path' => $path,
                'kind' => $kind,
                'defaultAccess' => 'view',
            ])
                ->assertStatus(400)
                ->assertJsonPath('code', 'bad_request');
        }

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'guest@example.com' => ['access' => 'view'],
            ],
        ])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_allows_view_edit_full_on_note_and_notebook_paths(): void
    {
        $ownerToken = $this->userBearerToken();
        $this->withBearer($ownerToken)
            ->postJson('/api/v1/notes/notebooks', ['name' => 'SharedNB'])
            ->assertCreated();

        $created = $this->createNoteFor($ownerToken, [
            'notebook' => 'SharedNB',
            'body' => 'note body',
        ]);
        $notePath = '/users/bob/.notes/SharedNB/'.$created['id'].'.md';
        $notebookPath = '/users/bob/.notes/SharedNB';

        foreach (['view', 'edit', 'full'] as $access) {
            $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
                'path' => $notePath,
                'kind' => 'member',
                'defaultAccess' => $access,
                'shareWith' => ['alice' => ['access' => $access]],
            ])
                ->assertOk()
                ->assertJsonPath('data.path', $notePath)
                ->assertJsonPath('data.defaultAccess', $access)
                ->assertJsonPath('data.kind', 'member');
        }

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $notebookPath,
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => ['carol' => ['access' => 'edit']],
        ])
            ->assertOk()
            ->assertJsonPath('data.path', $notebookPath)
            ->assertJsonPath('data.defaultAccess', 'edit');
    }

    public function test_drive_shared_with_me_excludes_notes_paths(): void
    {
        $ownerToken = $this->userBearerToken();
        $aliceToken = $this->adminBearerToken();

        Storage::disk('wgw_files')->put('users/bob/drive-doc.md', "# Drive\n");
        $created = $this->createNoteFor($ownerToken, [
            'notebook' => 'Drafts',
            'body' => 'secret note',
        ]);
        $notePath = '/users/bob/.notes/Drafts/'.$created['id'].'.md';

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/drive-doc.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $notePath,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $swm = $this->withBearer($aliceToken)->getJson('/api/v1/files/shared-with-me');
        $swm->assertOk();
        $paths = collect($swm->json('data'))->pluck('share.path')->all();
        $this->assertContains('/users/bob/drive-doc.md', $paths);
        $this->assertNotContains($notePath, $paths);
        foreach ($paths as $path) {
            $this->assertStringNotContainsString('/.notes/', (string) $path);
        }
    }

    public function test_notes_shared_listings_split_dirs_vs_files(): void
    {
        $ownerToken = $this->userBearerToken();
        $aliceToken = $this->adminBearerToken();

        $this->withBearer($ownerToken)
            ->postJson('/api/v1/notes/notebooks', ['name' => 'TeamPad'])
            ->assertCreated();

        $created = $this->createNoteFor($ownerToken, [
            'id' => 'shared-note-1',
            'notebook' => 'TeamPad',
            'body' => 'shared body',
        ]);
        Storage::disk('wgw_notes')->put(
            'users/bob/.notes/TeamPad/'.$created['id'].'.md',
            "title: Shared Title\ntags:\nstarred: false\n----\nshared body"
        );

        $notePath = '/users/bob/.notes/TeamPad/'.$created['id'].'.md';
        $notebookPath = '/users/bob/.notes/TeamPad';

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $notePath,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $notebookPath,
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        $notesSwm = $this->withBearer($aliceToken)->getJson('/api/v1/notes/shared-with-me');
        $notesSwm->assertOk()
            ->assertJsonPath('items.0.path', $notePath)
            ->assertJsonPath('items.0.id', $created['id'])
            ->assertJsonPath('items.0.notebook', 'TeamPad')
            ->assertJsonPath('items.0.title', 'Shared Title')
            ->assertJsonPath('items.0.owner', 'bob')
            ->assertJsonPath('items.0.access', 'view')
            ->assertJsonPath('items.0.myRights.mayView', true)
            ->assertJsonPath('items.0.myRights.mayComment', false)
            ->assertJsonPath('items.0.myRights.mayReview', false);
        $this->assertCount(1, $notesSwm->json('items'));

        $notebooks = $this->withBearer($aliceToken)->getJson('/api/v1/notes/shared-notebooks');
        $notebooks->assertOk()
            ->assertJsonPath('items.0.path', $notebookPath)
            ->assertJsonPath('items.0.notebook', 'TeamPad')
            ->assertJsonPath('items.0.owner', 'bob')
            ->assertJsonPath('items.0.access', 'edit')
            ->assertJsonPath('items.0.myRights.mayEditContent', true)
            ->assertJsonPath('items.0.myRights.mayComment', false);
        $this->assertCount(1, $notebooks->json('items'));
    }

    public function test_notes_shared_with_me_lists_grant_when_entry_lookup_misses(): void
    {
        $ownerToken = $this->userBearerToken();
        $aliceToken = $this->adminBearerToken();

        $created = $this->createNoteFor($ownerToken, [
            'id' => 'n1781784157',
            'notebook' => 'Drafts',
            'body' => 'seed body',
        ]);
        $notePath = '/users/bob/.notes/Drafts/'.$created['id'].'.md';

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $notePath,
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        // Remove the on-disk file so directoryEntryForSharePath returns null —
        // listing must still surface the grant from path meta (id + notebook).
        Storage::disk('wgw_notes')->delete('users/bob/.notes/Drafts/'.$created['id'].'.md');

        $this->withBearer($aliceToken)->getJson('/api/v1/notes/shared-with-me')
            ->assertOk()
            ->assertJsonPath('items.0.path', $notePath)
            ->assertJsonPath('items.0.id', 'n1781784157')
            ->assertJsonPath('items.0.notebook', 'Drafts')
            ->assertJsonPath('items.0.owner', 'bob')
            ->assertJsonPath('items.0.access', 'edit');
    }

    public function test_collab_rights_matrix_for_shared_note(): void
    {
        $ownerToken = $this->userBearerToken();
        $aliceToken = $this->adminBearerToken();
        $created = $this->createNoteFor($ownerToken, [
            'notebook' => 'Drafts',
            'body' => 'collab seed',
        ]);
        $path = '/users/bob/.notes/Drafts/'.$created['id'].'.md';

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $this->withBearer($aliceToken)
            ->get('/api/v1/files/collaboration?path='.urlencode($path))
            ->assertOk();

        $this->withBearer($aliceToken)
            ->putJson('/api/v1/files/collaboration?path='.urlencode($path), [
                'markdown' => 'blocked',
            ])
            ->assertForbidden();

        $this->withBearer($aliceToken)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode($path))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayView', true)
            ->assertJsonPath('data.myRights.mayComment', false)
            ->assertJsonPath('data.myRights.mayReview', false)
            ->assertJsonPath('data.myRights.mayEditContent', false);

        $shareId = (string) $this->withBearer($ownerToken)->getJson('/api/v1/files/shares?path='.urlencode($path))
            ->assertOk()
            ->json('data.0.id');
        $updatedAt = (string) $this->withBearer($ownerToken)->getJson('/api/v1/files/shares/'.$shareId)
            ->assertOk()
            ->json('data.updatedAt');

        $this->withBearer($ownerToken)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        $this->withBearer($aliceToken)
            ->putJson('/api/v1/files/collaboration?path='.urlencode($path), [
                'markdown' => 'edited body',
            ])
            ->assertOk();

        $this->withBearer($aliceToken)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode($path))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayEditContent', true)
            ->assertJsonPath('data.myRights.mayComment', false)
            ->assertJsonPath('data.myRights.mayReview', false);

        $updatedAt = (string) $this->withBearer($ownerToken)->getJson('/api/v1/files/shares/'.$shareId)
            ->assertOk()
            ->json('data.updatedAt');
        $this->withBearer($ownerToken)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'shareWith' => ['alice' => ['access' => 'full']],
        ])->assertOk();

        $this->withBearer($aliceToken)
            ->putJson('/api/v1/files/collaboration?path='.urlencode($path), [
                'markdown' => 'full edit body',
            ])
            ->assertOk();

        $this->withBearer($aliceToken)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode($path))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayManageStructure', true)
            ->assertJsonPath('data.myRights.mayComment', false)
            ->assertJsonPath('data.myRights.mayReview', false);
    }
}
