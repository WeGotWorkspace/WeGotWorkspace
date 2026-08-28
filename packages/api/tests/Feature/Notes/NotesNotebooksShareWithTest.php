<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class NotesNotebooksShareWithTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/alice');
    }

    public function test_owner_can_share_and_revoke_notebook(): void
    {
        $notebookId = (string) $this->asUser('bob')
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Shared Notes'])
            ->assertCreated()
            ->json('id');

        $this->asUser('bob')
            ->patchJson('/api/v1/notes/notebooks/'.$notebookId, [
                'shareWith' => ['alice' => ['mayWriteAll' => true]],
            ])
            ->assertOk();

        $shared = collect($this->asUser('alice')->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'))
            ->first(fn (array $row): bool => ($row['name'] ?? '') === 'Shared Notes');
        $this->assertIsArray($shared);
        $this->assertTrue($shared['isSharee']);
        $this->assertNull($shared['shareWith']);
        $this->assertTrue($shared['myRights']['mayWriteAll']);

        $note = $this->asUser('alice')->postJson('/api/v1/notes/items', [
            'notebookId' => $shared['id'],
            'title' => 'From Alice',
            'body' => 'hi',
        ])->assertCreated();

        $this->asUser('bob')
            ->patchJson('/api/v1/notes/notebooks/'.$notebookId, [
                'shareWith' => ['alice' => null],
            ])
            ->assertOk();

        $after = collect($this->asUser('alice')->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'))
            ->first(fn (array $row): bool => ($row['name'] ?? '') === 'Shared Notes');
        $this->assertNull($after);

        $this->asUser('alice')
            ->getJson('/api/v1/notes/items/'.$note->json('id'))
            ->assertNotFound();
    }

    public function test_read_share_denies_note_writes(): void
    {
        $notebookId = (string) $this->asUser('bob')
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Read Only'])
            ->assertCreated()
            ->json('id');
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$notebookId, [
            'shareWith' => ['alice' => ['mayReadItems' => true]],
        ])->assertOk();

        $noteId = (string) $this->asUser('bob')->postJson('/api/v1/notes/items', [
            'notebookId' => $notebookId,
            'title' => 'Owner note',
            'body' => 'x',
        ])->assertCreated()->json('id');

        $sharedId = (string) collect($this->asUser('alice')->getJson('/api/v1/notes/notebooks')->json('list'))
            ->first(fn (array $row): bool => ($row['name'] ?? '') === 'Read Only')['id'];

        $this->asUser('alice')->getJson('/api/v1/notes/items/'.$noteId)->assertOk();
        $this->asUser('alice')->postJson('/api/v1/notes/items', [
            'notebookId' => $sharedId,
            'title' => 'Nope',
            'body' => 'y',
        ])->assertForbidden();

        $etag = $this->asUser('alice')->getJson('/api/v1/notes/items/'.$noteId)->headers->get('ETag');
        $this->asUser('alice')->withHeaders(['If-Match' => (string) $etag])
            ->patchJson('/api/v1/notes/items/'.$noteId, ['title' => 'Hijack'])
            ->assertForbidden();
    }

    public function test_calendar_list_still_excludes_notebooks_after_share(): void
    {
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.CalendarCollectionUris::NOTE_GENERAL, [
            'shareWith' => ['alice' => ['mayWriteAll' => true]],
        ])->assertOk();

        $ids = app(\App\Services\Calendars\CalendarRepository::class)
            ->accessibleVeventInstances('alice')
            ->pluck('uri')
            ->all();
        $this->assertNotContains(CalendarCollectionUris::NOTE_GENERAL, $ids);
    }

    private function asUser(string $username)
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
