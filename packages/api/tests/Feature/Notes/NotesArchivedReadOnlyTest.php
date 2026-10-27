<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\NoteWriteTool;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Collab\CollabJoinAuthorizer;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Mcp\McpScopes;
use App\Services\Notes\NoteRepository;
use App\Services\Rtc\Signaling\RtcPeerAccess;
use Illuminate\Testing\TestResponse;
use Laravel\Passport\Passport;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ConfiguresMcp;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1535: an archived note (STATUS:CANCELLED) does not change until it is
 * restored. Restore, delete, and the personal star still work.
 */
final class NotesArchivedReadOnlyTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use SeedsWgwIdentity;
    use SendsFramedCollaboration;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
    }

    /**
     * @return iterable<string, array{0: array<string, mixed>}>
     */
    public static function refusedPatches(): iterable
    {
        yield 'title' => [['title' => 'Changed']];
        yield 'body' => [['body' => 'Changed']];
        yield 'categories' => [['categories' => ['changed']]];
        yield 'tag added' => [['categoriesAdd' => ['changed']]];
        yield 'tag removed' => [['categoriesRemove' => ['kept']]];
        yield 'yjs state' => [['yjs' => [0, 1, 2]]];
        yield 'restore with a title' => [['status' => 'FINAL', 'title' => 'Changed']];
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    #[DataProvider('refusedPatches')]
    public function test_a_patch_that_changes_an_archived_note_is_refused(array $patch): void
    {
        ['id' => $id, 'etag' => $etag] = $this->archivedNote();

        $this->patchNote($id, $etag, $patch)
            ->assertStatus(409)
            ->assertJsonPath('error', 'note_archived')
            ->assertJsonPath('code', 'note_archived');

        $this->readNote($id)
            ->assertOk()
            ->assertJsonPath('title', 'Kept')
            ->assertJsonPath('body', 'Kept body')
            ->assertJsonPath('categories', ['kept'])
            ->assertJsonPath('status', 'CANCELLED')
            ->assertJsonPath('etag', $etag);
    }

    public function test_a_move_of_an_archived_note_is_refused(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->archivedNote();
        $destination = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Elsewhere'])
            ->assertCreated()
            ->json('id');

        $this->patchNote($id, $etag, ['notebookId' => $destination])
            ->assertStatus(409)
            ->assertJsonPath('code', 'note_archived');

        $this->readNote($id)->assertOk()->assertJsonPath('notebookId', CalendarCollectionUris::NOTE_GENERAL);
    }

    public function test_restore_is_accepted_and_the_note_is_writable_again(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->archivedNote();

        $restored = $this->patchNote($id, $etag, ['status' => 'FINAL'])
            ->assertOk()
            ->assertJsonPath('status', 'FINAL');

        $this->patchNote($id, (string) $restored->json('etag'), ['title' => 'Changed'])
            ->assertOk()
            ->assertJsonPath('title', 'Changed');
    }

    public function test_archiving_an_archived_note_again_is_accepted(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->archivedNote();

        $this->patchNote($id, $etag, ['status' => 'CANCELLED'])
            ->assertOk()
            ->assertJsonPath('status', 'CANCELLED');
    }

    public function test_delete_and_star_are_accepted(): void
    {
        ['id' => $id] = $this->archivedNote();

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/notes/items/'.$id.'/star')
            ->assertOk();
        $this->readNote($id)->assertOk()->assertJsonPath('starred', true);

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->deleteJson('/api/v1/notes/items/'.$id)
            ->assertOk();
        $this->readNote($id)->assertNotFound();
    }

    public function test_a_collaborative_save_to_an_archived_note_is_refused(): void
    {
        ['id' => $id] = $this->archivedNote();

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->putCollaboration('/api/v1/notes/items/'.$id, 'Changed', "\x00\x01", ['If-None-Match' => '*'])
            ->assertStatus(409)
            ->assertJsonPath('error', 'note_archived')
            ->assertJsonPath('code', 'note_archived');

        $this->readNote($id)->assertOk()->assertJsonPath('body', 'Kept body');
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->get('/api/v1/notes/items/'.$id.'?format=yjs')
            ->assertNoContent();
    }

    public function test_jmap_note_set_refuses_an_edit_and_keeps_star_and_destroy(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->archivedNote();

        $refused = $this->jmap([
            ['Note/set', [
                'accountId' => 'bob',
                'update' => [$id => ['title' => 'Changed', 'etag' => $etag]],
            ], 'c0'],
        ])->assertOk();
        $refused->assertJsonPath("methodResponses.0.1.notUpdated.{$id}.type", 'forbidden');
        $refused->assertJsonPath("methodResponses.0.1.notUpdated.{$id}.description", 'note_archived');

        $starred = $this->jmap([
            ['Note/set', ['accountId' => 'bob', 'update' => [$id => ['starred' => true]]], 'c0'],
        ])->assertOk();
        $starred->assertJsonPath("methodResponses.0.1.updated.{$id}", null);

        $this->jmap([
            ['Note/set', ['accountId' => 'bob', 'destroy' => [$id]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed', [$id]);
    }

    public function test_mcp_note_write_refuses_an_edit_and_keeps_delete(): void
    {
        $this->enableMcp();
        ['id' => $id] = $this->archivedNote();
        $user = $this->mcpUser('bob');
        Passport::actingAs($user, [McpScopes::NOTES_WRITE], 'api', $this->mcpClient());

        WorkspaceServer::actingAs($user, 'api')
            ->tool(NoteWriteTool::class, ['action' => 'update', 'noteId' => $id, 'title' => 'Changed'])
            ->assertHasErrors(['note_archived']);
        $this->assertSame('Kept', app(NoteRepository::class)->show('bob', $id)['title']);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(NoteWriteTool::class, ['action' => 'delete', 'noteId' => $id])
            ->assertOk();
    }

    public function test_a_collab_peer_on_an_archived_note_is_read_only(): void
    {
        ['id' => $id] = $this->archivedNote();
        $active = $this->createNote();
        $authorizer = app(CollabJoinAuthorizer::class);
        $bob = ['username' => 'bob', 'role' => 'user'];

        $this->assertSame(RtcPeerAccess::READ, $authorizer->accessFor($id, $bob));
        $this->assertSame(RtcPeerAccess::WRITE, $authorizer->accessFor($active['id'], $bob));
    }

    /**
     * @return array{id: string, etag: string}
     */
    private function archivedNote(): array
    {
        ['id' => $id, 'etag' => $etag] = $this->createNote();
        $archived = $this->patchNote($id, $etag, ['status' => 'CANCELLED'])
            ->assertOk()
            ->assertJsonPath('status', 'CANCELLED');

        return ['id' => $id, 'etag' => (string) $archived->json('etag')];
    }

    /**
     * @return array{id: string, etag: string}
     */
    private function createNote(): array
    {
        $created = $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/notes/items', [
                'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                'title' => 'Kept',
                'body' => 'Kept body',
                'categories' => ['kept'],
            ])
            ->assertCreated();

        return ['id' => (string) $created->json('id'), 'etag' => (string) $created->json('etag')];
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function patchNote(string $id, string $etag, array $patch): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'))
            ->patchJson('/api/v1/notes/items/'.$id, $patch, ['If-Match' => $etag]);
    }

    private function readNote(string $id): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'))->getJson('/api/v1/notes/items/'.$id);
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
}
