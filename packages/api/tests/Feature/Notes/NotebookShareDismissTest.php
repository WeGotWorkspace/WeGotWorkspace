<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Dismissing an inbound notebook share ends access by every id, over REST and
 * JMAP, until the sharee restores it with `isSubscribed: true`. The owner's
 * grant stays.
 */
final class NotebookShareDismissTest extends WgwDatabaseTestCase
{
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

    public function test_dismissed_notebook_no_longer_resolves_by_id(): void
    {
        [$notebookId, $sharedId, $noteId] = $this->sharedNotebookWithNote('Dismiss Me');
        $ownNoteId = $this->createNote('alice', CalendarCollectionUris::NOTE_GENERAL, 'Mine');

        $this->asUser('alice')->deleteJson('/api/v1/notes/notebooks/'.$sharedId)->assertOk();

        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/notes/notebooks/'.$sharedId));
        $this->assertNotFound($this->asUser('alice')->patchJson('/api/v1/notes/notebooks/'.$sharedId, ['name' => 'Renamed']));
        $this->assertNotFound($this->asUser('alice')->deleteJson('/api/v1/notes/notebooks/'.$sharedId));
        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/notes/items?notebookId='.$sharedId));
        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/notes/items/changes?notebookId='.$sharedId));
        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/notes/items/'.$noteId));
        $this->assertNotFound($this->asUser('alice')->postJson('/api/v1/notes/items', [
            'notebookId' => $sharedId,
            'title' => 'Into a dismissed notebook',
            'body' => 'x',
        ]));
        $etag = (string) $this->asUser('alice')->getJson('/api/v1/notes/items/'.$ownNoteId)->assertOk()->headers->get('ETag');
        $this->assertNotFound($this->asUser('alice')
            ->withHeaders(['If-Match' => $etag])
            ->patchJson('/api/v1/notes/items/'.$ownNoteId, ['notebookId' => $sharedId]));

        $jmap = $this->jmapAs('alice', [
            ['Notebook/set', ['accountId' => 'alice', 'update' => [$sharedId => ['name' => 'Renamed']], 'destroy' => [$sharedId]], 'c0'],
            ['Note/set', ['accountId' => 'alice',
                'create' => ['n' => ['notebookId' => $sharedId, 'title' => 'Via JMAP', 'body' => 'x']],
                'update' => [$ownNoteId => ['notebookId' => $sharedId, 'etag' => $etag]],
            ], 'c1'],
        ]);
        $this->assertSame('notFound', $jmap->json('methodResponses.0.1.notUpdated.'.$sharedId.'.type'));
        $this->assertSame('notFound', $jmap->json('methodResponses.0.1.notDestroyed.'.$sharedId.'.type'));
        $this->assertSame('notFound', $jmap->json('methodResponses.1.1.notCreated.n.type'));
        $this->assertSame('notFound', $jmap->json('methodResponses.1.1.notUpdated.'.$ownNoteId.'.type'));
        $this->asUser('alice')->getJson('/api/v1/notes/items/'.$ownNoteId)->assertOk()
            ->assertJsonPath('notebookId', CalendarCollectionUris::NOTE_GENERAL);

        $this->assertNotContains('Dismiss Me', $this->notebookNames('alice'));
        $owner = $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$notebookId)->assertOk();
        $this->assertIsArray($owner->json('shareWith.alice'));
        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$noteId)->assertOk();
    }

    public function test_restoring_a_dismissed_notebook_brings_access_back(): void
    {
        [, $sharedId, $noteId] = $this->sharedNotebookWithNote('Come Back');
        $this->asUser('alice')->deleteJson('/api/v1/notes/notebooks/'.$sharedId)->assertOk();

        $this->asUser('alice')
            ->patchJson('/api/v1/notes/notebooks/'.$sharedId, ['isSubscribed' => true])
            ->assertOk()
            ->assertJsonPath('id', $sharedId)
            ->assertJsonPath('isSharee', true);

        $this->assertContains('Come Back', $this->notebookNames('alice'));
        $this->asUser('alice')->getJson('/api/v1/notes/items/'.$noteId)->assertOk();
        $this->createNote('alice', $sharedId, 'After restore');
    }

    public function test_jmap_restore_brings_a_dismissed_notebook_back(): void
    {
        [, $sharedId, $noteId] = $this->sharedNotebookWithNote('Via Jmap');
        $this->asUser('alice')->deleteJson('/api/v1/notes/notebooks/'.$sharedId)->assertOk();

        $restored = $this->jmapAs('alice', [
            ['Notebook/set', ['accountId' => 'alice', 'update' => [$sharedId => ['isSubscribed' => true]]], 'c0'],
        ]);
        $this->assertArrayHasKey($sharedId, (array) $restored->json('methodResponses.0.1.updated'));

        $this->asUser('alice')->getJson('/api/v1/notes/items/'.$noteId)->assertOk();
    }

    public function test_is_subscribed_false_dismisses_like_delete(): void
    {
        [$notebookId, $sharedId, $noteId] = $this->sharedNotebookWithNote('Unsubscribe');

        $this->asUser('alice')->patchJson('/api/v1/notes/notebooks/'.$sharedId, ['isSubscribed' => false])->assertOk();

        $this->assertNotContains('Unsubscribe', $this->notebookNames('alice'));
        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/notes/items/'.$noteId));
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$notebookId)->assertOk();
    }

    public function test_a_revoked_share_cannot_be_restored(): void
    {
        [$notebookId, $sharedId] = $this->sharedNotebookWithNote('Revoked');
        $this->asUser('alice')->deleteJson('/api/v1/notes/notebooks/'.$sharedId)->assertOk();
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$notebookId, ['shareWith' => ['alice' => null]])->assertOk();

        $this->assertNotFound($this->asUser('alice')->patchJson('/api/v1/notes/notebooks/'.$sharedId, ['isSubscribed' => true]));
        $this->assertNotContains('Revoked', $this->notebookNames('alice'));
    }

    /**
     * @return array{0: string, 1: string, 2: string} owner notebook id, sharee notebook id, owner note id
     */
    private function sharedNotebookWithNote(string $name): array
    {
        $notebookId = (string) $this->asUser('bob')
            ->postJson('/api/v1/notes/notebooks', ['name' => $name])
            ->assertCreated()
            ->json('id');
        $this->asUser('bob')
            ->patchJson('/api/v1/notes/notebooks/'.$notebookId, ['shareWith' => ['alice' => ['mayWriteAll' => true]]])
            ->assertOk();
        $noteId = $this->createNote('bob', $notebookId, 'Owner note');

        $shared = collect($this->asUser('alice')->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'))
            ->first(fn (array $row): bool => ($row['name'] ?? '') === $name);
        $this->assertIsArray($shared);

        return [$notebookId, (string) $shared['id'], $noteId];
    }

    private function createNote(string $username, string $notebookId, string $title): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/notes/items', ['notebookId' => $notebookId, 'title' => $title, 'body' => 'x'])
            ->assertCreated()
            ->json('id');
    }

    /**
     * @return list<string>
     */
    private function notebookNames(string $username): array
    {
        return collect($this->asUser($username)->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'))
            ->pluck('name')
            ->all();
    }

    private function assertNotFound(TestResponse $response): void
    {
        $response->assertNotFound()->assertJsonPath('code', 'not_found');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::NOTES],
            'methodCalls' => $methodCalls,
        ])->assertOk();
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
