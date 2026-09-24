<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\NotebookListTool;
use App\Mcp\Tools\NotebookShareTool;
use App\Mcp\Tools\NotebookWriteTool;
use App\Mcp\Tools\NotesQueryTool;
use App\Mcp\Tools\NotesSearchTool;
use App\Mcp\Tools\NoteWriteTool;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Mcp\McpScopes;
use App\Services\Notes\NotebookRepository;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class McpNotesToolsTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableMcp();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('carol', displayName: 'Carol');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/alice');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/carol');
    }

    public function test_notes_search_stays_notes_only(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::NOTES_READ], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(NotesSearchTool::class, ['query' => 'hello'])
            ->assertOk();
    }

    public function test_notebook_list_and_note_write_happy_path(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::NOTES_READ, McpScopes::NOTES_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(NotebookListTool::class)
            ->assertOk()
            ->assertSee(CalendarCollectionUris::NOTE_GENERAL);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(NotebookWriteTool::class, [
                'action' => 'create',
                'name' => 'Ideas',
            ])
            ->assertOk()
            ->assertSee('Ideas');
        $notebookId = $this->notebookIdNamed('bob', 'Ideas');

        WorkspaceServer::actingAs($user, 'api')
            ->tool(NoteWriteTool::class, [
                'action' => 'create',
                'notebookId' => $notebookId,
                'title' => 'Standup notes',
                'body' => 'Ship the tools',
                'categories' => ['mcp', 'work'],
            ])
            ->assertOk()
            ->assertSee('Standup notes')
            ->assertSee('Ship the tools');

        WorkspaceServer::actingAs($user, 'api')
            ->tool(NotesQueryTool::class, ['notebookId' => $notebookId])
            ->assertOk()
            ->assertSee('Standup notes');
    }

    public function test_note_write_denies_read_scope(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::NOTES_READ], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(NoteWriteTool::class, [
                'action' => 'create',
                'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                'title' => 'Blocked',
            ])
            ->assertHasErrors(['Missing OAuth scope: notes.write']);
    }

    public function test_legacy_docs_scope_can_write_notes(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::DOCS], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(NoteWriteTool::class, [
                'action' => 'create',
                'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                'title' => 'Legacy note',
                'body' => 'from docs alias',
            ])
            ->assertOk()
            ->assertSee('Legacy note');
    }

    public function test_note_write_enforces_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $carol = $this->mcpUser('carol');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::NOTES_WRITE], 'api', $client);
        WorkspaceServer::actingAs($bob, 'api')
            ->tool(NotebookWriteTool::class, ['action' => 'create', 'name' => 'Private'])
            ->assertOk();
        $notebookId = $this->notebookIdNamed('bob', 'Private');

        Passport::actingAs($carol, [McpScopes::NOTES_WRITE], 'api', $client);
        WorkspaceServer::actingAs($carol, 'api')
            ->tool(NoteWriteTool::class, [
                'action' => 'create',
                'notebookId' => $notebookId,
                'title' => 'Nope',
            ])
            ->assertHasErrors(['Notebook not found']);
    }

    public function test_notebook_share_round_trip_and_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('alice');
        $carol = $this->mcpUser('carol');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::NOTES_WRITE], 'api', $client);
        WorkspaceServer::actingAs($bob, 'api')
            ->tool(NotebookWriteTool::class, ['action' => 'create', 'name' => 'Shared'])
            ->assertOk();
        $notebookId = $this->notebookIdNamed('bob', 'Shared');

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(NotebookShareTool::class, [
                'action' => 'set',
                'notebookId' => $notebookId,
                'shareWith' => ['alice' => ['mayReadItems' => true]],
            ])
            ->assertOk()
            ->assertSee('alice');

        Passport::actingAs($carol, [McpScopes::NOTES_WRITE], 'api', $client);
        WorkspaceServer::actingAs($carol, 'api')
            ->tool(NotebookShareTool::class, [
                'action' => 'set',
                'notebookId' => $notebookId,
                'shareWith' => ['bob' => ['mayReadItems' => true]],
            ])
            ->assertHasErrors(['Notebook not found']);
    }

    private function notebookIdNamed(string $username, string $name): string
    {
        $row = collect(app(NotebookRepository::class)->list($username)['list'])
            ->first(static fn (array $notebook): bool => ($notebook['name'] ?? '') === $name);
        $this->assertIsArray($row);

        return (string) $row['id'];
    }
}
