<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Services\Notes\NoteMarkdownCodec;
use App\Storage\WgwStorage;
use Tests\Support\NotesTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A body-only collab save (`PUT /files/collaboration`) must not perturb the
 * note's metadata `updated` marker. Otherwise an offline metadata change that
 * flushes later with its pre-body-edit `ifInState` would see the server as
 * "newer" and raise a spurious NotesConflictDialog stateMismatch.
 */
final class NotesCollabBodyStateTest extends WgwDatabaseTestCase
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

    public function test_collab_body_save_does_not_advance_note_updated_marker(): void
    {
        $token = $this->userBearerToken();
        $created = $this->createNoteFor($token, [
            'notebook' => 'Drafts',
            'body' => 'original body',
            'tags' => ['keep'],
        ]);
        $beforeUpdatedAt = (string) $created['item']['updatedAt'];
        $this->assertNotSame('', $beforeUpdatedAt);

        $codec = new NoteMarkdownCodec;
        $disk = app(WgwStorage::class)->files();
        $disk->put(
            $created['key'],
            "title: Stable meta\ntags: keep\nupdated: {$beforeUpdatedAt}\n----\noriginal body"
        );

        $room = $created['path'];
        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode($room), [
                'markdown' => "rewritten body from collab\n",
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $raw = (string) $disk->get($created['key']);
        $this->assertStringContainsString('title: Stable meta', $raw);
        $this->assertStringContainsString('tags: keep', $raw);
        $this->assertStringContainsString('rewritten body from collab', $raw);
        $this->assertSame($beforeUpdatedAt, $codec->updatedOf($raw));
        $this->assertSame('rewritten body from collab', trim($codec->bodyOf($raw)));
    }
}
