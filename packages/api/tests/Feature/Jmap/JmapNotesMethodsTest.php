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
}
