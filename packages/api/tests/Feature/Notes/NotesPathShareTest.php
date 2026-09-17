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
        $path = $created['path'];

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
        $path = $created['path'];

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

    public function test_allows_view_edit_and_rejects_full_and_notebook_dir_shares(): void
    {
        $ownerToken = $this->userBearerToken();
        $created = $this->createNoteFor($ownerToken, [
            'notebook' => 'SharedNB',
            'body' => 'note body',
        ]);
        $notePath = $created['path'];
        $notebookPath = '/users/bob/.notes/SharedNB';

        foreach (['view', 'edit'] as $access) {
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
            'path' => $notePath,
            'kind' => 'member',
            'defaultAccess' => 'full',
            'shareWith' => ['alice' => ['access' => 'full']],
        ])
            ->assertStatus(400)
            ->assertJsonPath('code', 'comment_not_applicable');

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $notebookPath,
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => ['carol' => ['access' => 'edit']],
        ])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_drive_shared_with_me_excludes_notes_unless_include_notes(): void
    {
        $ownerToken = $this->userBearerToken();
        $aliceToken = $this->adminBearerToken();

        Storage::disk('wgw_files')->put('users/bob/drive-doc.md', "# Drive\n");
        $created = $this->createNoteFor($ownerToken, [
            'notebook' => 'Drafts',
            'body' => 'secret note',
        ]);
        $notePath = $created['path'];

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

        $withNotes = $this->withBearer($aliceToken)->getJson('/api/v1/files/shared-with-me?includeNotes=true');
        $withNotes->assertOk();
        $included = collect($withNotes->json('data'))->pluck('share.path')->all();
        $this->assertContains('/users/bob/drive-doc.md', $included);
        $this->assertNotContains($notePath, $included);
    }

    public function test_collab_rights_matrix_for_shared_note(): void
    {
        $ownerToken = $this->userBearerToken();
        $aliceToken = $this->adminBearerToken();
        $created = $this->createNoteFor($ownerToken, [
            'notebook' => 'Drafts',
            'body' => 'collab seed',
        ]);
        $path = $created['path'];

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        // Owner retains write after granting view-only to a teammate.
        $this->withBearer($ownerToken)
            ->putJson('/api/v1/files/collaboration?path='.urlencode($path), [
                'markdown' => 'owner still writes',
            ])
            ->assertOk();

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
            ->assertJsonPath('data.myRights.mayManageStructure', false)
            ->assertJsonPath('data.myRights.mayComment', false)
            ->assertJsonPath('data.myRights.mayReview', false);

        $updatedAt = (string) $this->withBearer($ownerToken)->getJson('/api/v1/files/shares/'.$shareId)
            ->assertOk()
            ->json('data.updatedAt');
        $this->withBearer($ownerToken)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'shareWith' => ['alice' => ['access' => 'full']],
        ])
            ->assertStatus(400)
            ->assertJsonPath('code', 'comment_not_applicable');
    }
}
