<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\McpToolCatalog;
use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\DocsReadTool;
use App\Mcp\Tools\DocsSearchTool;
use App\Mcp\Tools\DocsShareTool;
use App\Mcp\Tools\DocsWriteTool;
use App\Services\Mcp\McpScopes;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class McpDocsToolsTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->enableMcp();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_docs_write_read_search_and_share_happy_path(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('alice');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DOCS_READ, McpScopes::DOCS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsWriteTool::class, [
                'action' => 'create',
                'path' => '/users/bob/mcp-spec.md',
                'text' => '# Spec hello from docs',
            ])
            ->assertOk()
            ->assertSee('/users/bob/mcp-spec.md');

        $this->assertSame('# Spec hello from docs', Storage::disk('wgw_files')->get('users/bob/mcp-spec.md'));

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsWriteTool::class, [
                'action' => 'update',
                'path' => '/users/bob/mcp-spec.md',
                'text' => '# Spec updated',
            ])
            ->assertOk();

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsReadTool::class, ['path' => '/users/bob/mcp-spec.md'])
            ->assertOk()
            ->assertSee('# Spec updated');

        Storage::disk('wgw_files')->put('users/bob/mcp-notes.txt', 'not a doc');
        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsSearchTool::class, ['query' => 'mcp-spec'])
            ->assertOk()
            ->assertSee('/users/bob/mcp-spec.md')
            ->assertDontSee('mcp-notes.txt');

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsShareTool::class, [
                'action' => 'set',
                'path' => '/users/bob/mcp-spec.md',
                'kind' => 'member',
                'shareWith' => ['alice' => ['access' => 'view']],
            ])
            ->assertOk()
            ->assertSee('alice');
    }

    public function test_docs_write_denies_read_scope_and_drive_write(): void
    {
        $bob = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DOCS_READ], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsWriteTool::class, [
                'action' => 'create',
                'path' => '/users/bob/blocked.md',
                'text' => 'nope',
            ])
            ->assertHasErrors(['Missing OAuth scope: docs.write']);

        Passport::actingAs($bob, [McpScopes::DRIVE_WRITE], 'api', $client);
        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsWriteTool::class, [
                'action' => 'create',
                'path' => '/users/bob/blocked.md',
                'text' => 'nope',
            ])
            ->assertHasErrors(['Missing OAuth scope: docs.write']);
    }

    public function test_legacy_docs_scope_can_write(): void
    {
        $bob = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DOCS], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsWriteTool::class, [
                'action' => 'create',
                'path' => '/users/bob/legacy.md',
                'text' => 'from docs alias',
            ])
            ->assertOk()
            ->assertSee('/users/bob/legacy.md');
    }

    public function test_docs_write_enforces_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('carol');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DOCS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsWriteTool::class, [
                'action' => 'create',
                'path' => '/users/carol/private.md',
                'text' => 'nope',
            ])
            ->assertHasErrors(['Access denied']);
    }

    public function test_docs_share_enforces_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('carol');
        Storage::disk('wgw_files')->put('users/carol/private.md', 'carol only');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DOCS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsShareTool::class, [
                'action' => 'set',
                'path' => '/users/carol/private.md',
                'kind' => 'member',
                'shareWith' => ['bob' => ['access' => 'view']],
            ])
            ->assertHasErrors(['Cannot share this path']);
    }

    public function test_docs_rejects_non_markdown_path(): void
    {
        $bob = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DOCS_READ, McpScopes::DOCS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DocsReadTool::class, ['path' => '/users/bob/notes.txt'])
            ->assertHasErrors(['path must be a Markdown (.md) Docs file.']);
    }

    public function test_catalog_hides_docs_when_files_disabled(): void
    {
        $this->setAppSetting(WgwSettings::FILES_ENABLED, false);
        $tools = app(McpToolCatalog::class)->enabledTools();
        $this->assertNotContains(DocsSearchTool::class, $tools);
        $this->assertNotContains(DocsWriteTool::class, $tools);
        $this->assertNotContains(DocsShareTool::class, $tools);
    }
}
