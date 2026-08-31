<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Vendor Notes envelope (#671): Notebook/Note get|changes|set over VJOURNAL repos.
 */
final class JmapNotesMethodsTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'))->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::NOTES],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_session_advertises_vendor_notes_capability(): void
    {
        $session = $this->withBearer($this->issueBearerTokenFor('bob'))
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();

        $this->assertSame([], $session['capabilities'][JmapCapabilities::NOTES]);
        $notes = $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::NOTES];
        $this->assertSame(1, $notes['maxNotebooksPerNote']);
        $this->assertTrue($notes['mayCreateNotebook']);
        $this->assertSame('bob', $session['primaryAccounts'][JmapCapabilities::NOTES]);
    }

    public function test_notes_feature_gate_drops_the_domain_without_taking_the_envelope_down(): void
    {
        $this->setAppSetting(WgwSettings::NOTES_ENABLED, false);

        $session = $this->withBearer($this->issueBearerTokenFor('bob'))
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $this->assertArrayNotHasKey(JmapCapabilities::NOTES, $session['capabilities']);
        $this->assertArrayNotHasKey(JmapCapabilities::NOTES, $session['primaryAccounts']);

        $this->withBearer($this->issueBearerTokenFor('bob'))->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::NOTES],
            'methodCalls' => [['Core/echo', ['a' => 1], 'c0']],
        ])->assertStatus(400)->assertJsonPath('type', 'urn:ietf:params:jmap:error:unknownCapability');
    }

    public function test_notebook_get_returns_general_with_decomposable_state(): void
    {
        $response = $this->jmap([
            ['Notebook/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'Notebook/get');
        $args = $response->json('methodResponses.0.1');
        $this->assertSame('bob', $args['accountId']);
        $this->assertNotNull(JmapAccountStateCodec::decompose($args['state']));

        $general = collect($args['list'])->firstWhere('id', CalendarCollectionUris::NOTE_GENERAL);
        $this->assertNotNull($general);
        $this->assertSame('General', $general['name']);
        $this->assertSame([], $args['notFound']);
    }

    public function test_note_changes_and_get_batch_after_create(): void
    {
        $created = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'create' => ['k0' => [
                    'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                    'title' => 'Hello',
                    'body' => 'World',
                ]],
            ], 'c0'],
        ])->assertOk();

        $created->assertJsonPath('methodResponses.0.0', 'Note/set');
        $noteId = $created->json('methodResponses.0.1.created.k0.id');
        $this->assertIsString($noteId);
        $newState = $created->json('methodResponses.0.1.newState');

        $batch = $this->jmap([
            ['Note/changes', ['accountId' => 'bob', 'sinceState' => '0:'], 'c0'],
            ['Note/get', ['accountId' => 'bob', 'ids' => [$noteId]], 'c1'],
        ])->assertOk();

        $batch->assertJsonPath('methodResponses.0.0', 'Note/changes');
        $changes = $batch->json('methodResponses.0.1');
        $this->assertContains($noteId, $changes['created']);
        $this->assertSame($newState, $changes['newState']);

        $batch->assertJsonPath('methodResponses.1.0', 'Note/get');
        $got = $batch->json('methodResponses.1.1.list.0');
        $this->assertSame($noteId, $got['id']);
        $this->assertSame('Hello', $got['title']);
        $this->assertSame('World', $got['body']);
    }

    public function test_note_set_stale_if_in_state_is_state_mismatch_without_mutating(): void
    {
        $before = $this->jmap([
            ['Note/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $this->assertSame([], $before);

        $response = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'ifInState' => '1:notes-general:999999',
                'create' => ['k0' => [
                    'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                    'title' => 'Should not persist',
                ]],
            ], 'c0'],
            ['Note/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'error');
        $response->assertJsonPath('methodResponses.0.1.type', 'stateMismatch');
        $this->assertSame([], $response->json('methodResponses.1.1.list'));
    }

    public function test_note_query_changes_cannot_calculate(): void
    {
        $this->jmap([
            ['Note/queryChanges', ['accountId' => 'bob', 'sinceQueryState' => '0'], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }

    public function test_notebook_set_create_rename_and_destroy_empty(): void
    {
        $created = $this->jmap([
            ['Notebook/set', [
                'accountId' => 'bob',
                'create' => ['k0' => ['name' => 'Scratch', 'color' => '#ec4899']],
            ], 'c0'],
        ])->assertOk();
        $created->assertJsonPath('methodResponses.0.0', 'Notebook/set');
        $id = $created->json('methodResponses.0.1.created.k0.id');
        $this->assertIsString($id);
        $this->assertNotSame('', $id);
        $this->assertSame('Scratch', $created->json('methodResponses.0.1.created.k0.name'));

        $renamed = $this->jmap([
            ['Notebook/set', [
                'accountId' => 'bob',
                'update' => [$id => ['name' => 'Lab']],
            ], 'c0'],
        ])->assertOk();
        $renamed->assertJsonPath("methodResponses.0.1.updated.{$id}", null);

        $got = $this->jmap([
            ['Notebook/get', ['accountId' => 'bob', 'ids' => [$id]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('Lab', $got['name']);

        $destroyed = $this->jmap([
            ['Notebook/set', ['accountId' => 'bob', 'destroy' => [$id]], 'c0'],
        ])->assertOk();
        $destroyed->assertJsonPath('methodResponses.0.1.destroyed', [$id]);
        $this->assertSame([], $destroyed->json('methodResponses.0.1.notDestroyed') ?? []);
    }

    public function test_notebook_set_destroy_with_contents_requires_on_destroy_remove(): void
    {
        $notebookId = $this->jmap([
            ['Notebook/set', [
                'accountId' => 'bob',
                'create' => ['k0' => ['name' => 'Filled']],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.k0.id');

        $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'create' => ['n0' => ['notebookId' => $notebookId, 'title' => 'Keep']],
            ], 'c1'],
        ])->assertOk()->assertJsonPath('methodResponses.0.0', 'Note/set');

        $blocked = $this->jmap([
            ['Notebook/set', ['accountId' => 'bob', 'destroy' => [$notebookId]], 'c0'],
        ])->assertOk();
        $blocked->assertJsonPath("methodResponses.0.1.notDestroyed.{$notebookId}.type", 'notebookHasContents');
        $this->assertSame([], $blocked->json('methodResponses.0.1.destroyed') ?? []);

        $purged = $this->jmap([
            ['Notebook/set', [
                'accountId' => 'bob',
                'destroy' => [$notebookId],
                'onDestroyRemoveContents' => true,
            ], 'c0'],
        ])->assertOk();
        $purged->assertJsonPath('methodResponses.0.1.destroyed', [$notebookId]);
        $this->assertSame([], $purged->json('methodResponses.0.1.notDestroyed') ?? []);
    }

    public function test_notebook_set_cannot_destroy_general(): void
    {
        $response = $this->jmap([
            ['Notebook/set', [
                'accountId' => 'bob',
                'destroy' => [CalendarCollectionUris::NOTE_GENERAL],
                'onDestroyRemoveContents' => true,
            ], 'c0'],
        ])->assertOk();
        $response->assertJsonPath(
            'methodResponses.0.1.notDestroyed.'.CalendarCollectionUris::NOTE_GENERAL.'.type',
            'forbidden',
        );
    }

    public function test_note_set_update_star_and_destroy(): void
    {
        $created = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'create' => ['k0' => [
                    'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                    'title' => 'Draft',
                    'body' => 'Hi',
                    'starred' => true,
                ]],
            ], 'c0'],
        ])->assertOk();
        $noteId = $created->json('methodResponses.0.1.created.k0.id');
        $etag = $created->json('methodResponses.0.1.created.k0.etag');
        $this->assertTrue($created->json('methodResponses.0.1.created.k0.starred'));
        $this->assertIsString($etag);

        $patched = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'update' => [$noteId => ['title' => 'Ready', 'starred' => false, 'etag' => $etag]],
            ], 'c0'],
        ])->assertOk();
        $patched->assertJsonPath("methodResponses.0.1.updated.{$noteId}", null);
        $this->assertSame([], $patched->json('methodResponses.0.1.notUpdated') ?? []);

        $got = $this->jmap([
            ['Note/get', ['accountId' => 'bob', 'ids' => [$noteId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('Ready', $got['title']);
        $this->assertFalse($got['starred']);

        $destroyed = $this->jmap([
            ['Note/set', ['accountId' => 'bob', 'destroy' => [$noteId]], 'c0'],
        ])->assertOk();
        $destroyed->assertJsonPath('methodResponses.0.1.destroyed', [$noteId]);
    }

    public function test_note_set_update_without_etag_is_state_mismatch(): void
    {
        $created = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'create' => ['k0' => [
                    'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                    'title' => 'Draft',
                ]],
            ], 'c0'],
        ])->assertOk();
        $noteId = $created->json('methodResponses.0.1.created.k0.id');
        $before = $this->jmap([
            ['Note/get', ['accountId' => 'bob', 'ids' => [$noteId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $ungarded = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'update' => [$noteId => ['title' => 'Lost write']],
            ], 'c0'],
        ])->assertOk();
        $ungarded->assertJsonPath("methodResponses.0.1.notUpdated.{$noteId}.type", 'stateMismatch');
        $this->assertArrayNotHasKey($noteId, $ungarded->json('methodResponses.0.1.updated') ?? []);

        $got = $this->jmap([
            ['Note/get', ['accountId' => 'bob', 'ids' => [$noteId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('Draft', $got['title']);
        $this->assertSame($before['etag'], $got['etag']);
    }

    public function test_note_set_ignores_client_supplied_uid(): void
    {
        $hostile = 'alice-secret-note-uid';
        $created = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'create' => ['k0' => [
                    'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                    'title' => 'Mine',
                    'uid' => $hostile,
                ]],
            ], 'c0'],
        ])->assertOk();
        $noteId = $created->json('methodResponses.0.1.created.k0.id');
        $this->assertIsString($noteId);
        $this->assertNotSame($hostile, $noteId);
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
            $noteId,
        );
    }

    public function test_note_set_move_and_changes_does_not_report_destroyed(): void
    {
        $destId = $this->jmap([
            ['Notebook/set', [
                'accountId' => 'bob',
                'create' => ['k0' => ['name' => 'Dest']],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.k0.id');

        $before = $this->jmap([
            ['Note/get', ['accountId' => 'bob', 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $created = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'create' => ['n0' => [
                    'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                    'title' => 'Travel',
                    'body' => 'keep',
                ]],
            ], 'c0'],
        ])->assertOk();
        $noteId = $created->json('methodResponses.0.1.created.n0.id');
        $etag = $created->json('methodResponses.0.1.created.n0.etag');

        $moved = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'update' => [$noteId => ['notebookId' => $destId, 'etag' => $etag]],
            ], 'c0'],
        ])->assertOk();
        $moved->assertJsonPath("methodResponses.0.1.updated.{$noteId}", null);
        $this->assertSame([], $moved->json('methodResponses.0.1.notUpdated') ?? []);

        $got = $this->jmap([
            ['Note/get', ['accountId' => 'bob', 'ids' => [$noteId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame($destId, $got['notebookId']);
        $this->assertSame('keep', $got['body']);

        $changes = $this->jmap([
            ['Note/changes', ['accountId' => 'bob', 'sinceState' => $before], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($noteId, array_merge($changes['created'], $changes['updated']));
        $this->assertNotContains($noteId, $changes['destroyed']);
    }

    public function test_notebook_and_note_changes_after_purge(): void
    {
        $notebookId = $this->jmap([
            ['Notebook/set', [
                'accountId' => 'bob',
                'create' => ['k0' => ['name' => 'Doomed']],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.k0.id');
        $noteId = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'create' => ['n0' => ['notebookId' => $notebookId, 'title' => 'Gone']],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.n0.id');

        $afterCreateNotebooks = $this->jmap([
            ['Notebook/get', ['accountId' => 'bob', 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');
        $afterCreateNotes = $this->jmap([
            ['Note/get', ['accountId' => 'bob', 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $this->jmap([
            ['Notebook/set', [
                'accountId' => 'bob',
                'destroy' => [$notebookId],
                'onDestroyRemoveContents' => true,
            ], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed', [$notebookId]);

        $this->jmap([
            ['Notebook/get', ['accountId' => 'bob', 'ids' => [$notebookId]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.notFound', [$notebookId]);
        $this->jmap([
            ['Note/get', ['accountId' => 'bob', 'ids' => [$noteId]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.notFound', [$noteId]);

        $notebookChanges = $this->jmap([
            ['Notebook/changes', ['accountId' => 'bob', 'sinceState' => $afterCreateNotebooks], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($notebookId, $notebookChanges['destroyed']);
        $this->assertNotContains($notebookId, $notebookChanges['updated']);
        $this->assertNotContains($notebookId, $notebookChanges['created']);

        $noteChanges = $this->jmap([
            ['Note/changes', ['accountId' => 'bob', 'sinceState' => $afterCreateNotes], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertNotContains($noteId, $noteChanges['updated']);
        $this->assertNotContains($noteId, $noteChanges['created']);
        $this->assertContains($noteId, $noteChanges['destroyed']);
    }
}
