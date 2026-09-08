<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\McpToolCatalog;
use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\DriveReadTool;
use App\Mcp\Tools\DriveSearchTool;
use App\Mcp\Tools\WgwMcpTool;
use App\Mcp\Tools\WhoamiTool;
use App\Models\McpAuditEvent;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use App\Support\WgwSettings;
use App\Ui\UiStaticServer;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\Storage;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class McpToolsTest extends WgwDatabaseTestCase
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

    public function test_whoami_requires_settings_scope_and_is_audited(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::DRIVE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(WhoamiTool::class)
            ->assertHasErrors(['Missing OAuth scope: settings']);

        $this->assertSame(1, McpAuditEvent::query()->where('event_type', McpAuditLogger::TOOL_CALL)->where('outcome', 'denied')->count());
    }

    public function test_whoami_returns_username_when_scoped(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::SETTINGS], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(WhoamiTool::class)
            ->assertOk()
            ->assertSee('bob');

        $this->assertSame(1, McpAuditEvent::query()->where('tool', 'whoami')->where('outcome', 'ok')->count());
        $event = McpAuditEvent::query()->where('tool', 'whoami')->first();
        $this->assertNotNull($event);
        $this->assertSame('profile', $event->target);
        $this->assertStringNotContainsString('secret', (string) $event->target);
    }

    public function test_drive_read_enforces_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('carol');
        Storage::disk('wgw_files')->put('users/carol/private.txt', 'carol only');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DRIVE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveReadTool::class, ['path' => '/users/carol/private.txt'])
            ->assertHasErrors(['Access denied']);
    }

    public function test_drive_read_returns_text_preview_for_own_file(): void
    {
        $bob = $this->mcpUser('bob');
        Storage::disk('wgw_files')->put('users/bob/notes.txt', 'hello from drive');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DRIVE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveReadTool::class, ['path' => '/users/bob/notes.txt'])
            ->assertOk()
            ->assertSee('hello from drive');
    }

    public function test_catalog_hides_drive_when_files_disabled(): void
    {
        $this->setAppSetting(WgwSettings::FILES_ENABLED, false);
        $tools = app(McpToolCatalog::class)->enabledTools();
        $this->assertNotContains(DriveSearchTool::class, $tools);
        $this->assertNotContains(DriveReadTool::class, $tools);
    }

    public function test_hard_refusal_blocks_admin_named_tools(): void
    {
        $user = $this->mcpUser('bob');
        Passport::actingAs($user, McpScopes::ids(), 'api', $this->mcpClient());

        $tool = new class(app(McpAuditLogger::class), app(AdminRoleResolver::class)) extends WgwMcpTool
        {
            protected string $name = 'admin_wipe';

            protected string $description = 'Must never run via MCP.';

            public function schema(JsonSchema $schema): array
            {
                return [];
            }

            protected function requiredScope(): ?string
            {
                return null;
            }

            protected function accessMode(): string
            {
                return 'write';
            }

            protected function target(Request $request): array|string|null
            {
                return 'admin';
            }

            protected function run(Request $request): Response
            {
                return $this->json(['ok' => true]);
            }
        };

        $response = $tool->handle(new Request([]));
        $this->assertTrue($response->isError());
        $this->assertSame(1, McpAuditEvent::query()->where('tool', 'admin_wipe')->where('outcome', 'denied')->count());
    }

    public function test_mcp_is_not_a_spa_shell_prefix(): void
    {
        $this->assertNotContains('/mcp', UiStaticServer::spaRoutePrefixes());
        $this->assertNotContains('/oauth', UiStaticServer::spaRoutePrefixes());
    }
}
