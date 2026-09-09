<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\McpToolCatalog;
use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\DriveShareTool;
use App\Mcp\Tools\DriveWriteTool;
use App\Services\Mcp\McpScopes;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class McpDriveWriteToolsTest extends WgwDatabaseTestCase
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

    public function test_drive_write_denies_read_scope_and_allows_write(): void
    {
        $bob = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DRIVE_READ], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveWriteTool::class, [
                'action' => 'write_text',
                'path' => '/users/bob/mcp.txt',
                'text' => 'hello',
            ])
            ->assertHasErrors(['Missing OAuth scope: drive.write']);

        Passport::actingAs($bob, [McpScopes::DRIVE_WRITE], 'api', $client);
        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveWriteTool::class, [
                'action' => 'write_text',
                'path' => '/users/bob/mcp.txt',
                'text' => 'hello from mcp',
            ])
            ->assertOk()
            ->assertSee('/users/bob/mcp.txt');

        $this->assertSame('hello from mcp', Storage::disk('wgw_files')->get('users/bob/mcp.txt'));
    }

    public function test_legacy_drive_scope_can_write(): void
    {
        $bob = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DRIVE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveWriteTool::class, [
                'action' => 'mkdir',
                'path' => '/users/bob/mcp-dir',
            ])
            ->assertOk();
    }

    public function test_drive_write_enforces_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('carol');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DRIVE_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveWriteTool::class, [
                'action' => 'write_text',
                'path' => '/users/carol/private.txt',
                'text' => 'nope',
            ])
            ->assertHasErrors(['Access denied']);
    }

    public function test_drive_write_move_and_delete(): void
    {
        $bob = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DRIVE_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveWriteTool::class, [
                'action' => 'write_text',
                'path' => '/users/bob/from.txt',
                'text' => 'move me',
            ])
            ->assertOk();

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveWriteTool::class, [
                'action' => 'move',
                'from' => '/users/bob/from.txt',
                'to' => '/users/bob/to.txt',
            ])
            ->assertOk();

        $this->assertFalse(Storage::disk('wgw_files')->fileExists('users/bob/from.txt'));
        $this->assertSame('move me', Storage::disk('wgw_files')->get('users/bob/to.txt'));

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveWriteTool::class, [
                'action' => 'delete',
                'path' => '/users/bob/to.txt',
            ])
            ->assertOk();

        $this->assertFalse(Storage::disk('wgw_files')->fileExists('users/bob/to.txt'));
    }

    public function test_drive_share_get_set_and_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('alice');
        $this->mcpUser('carol');
        Storage::disk('wgw_files')->put('users/bob/shared.txt', 'share me');
        Storage::disk('wgw_files')->put('users/carol/private.txt', 'carol only');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::DRIVE_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveShareTool::class, [
                'action' => 'set',
                'path' => '/users/bob/shared.txt',
                'kind' => 'member',
                'shareWith' => ['alice' => ['access' => 'view']],
            ])
            ->assertOk()
            ->assertSee('alice');

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveShareTool::class, [
                'action' => 'get',
                'path' => '/users/bob/shared.txt',
            ])
            ->assertOk()
            ->assertSee('alice');

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(DriveShareTool::class, [
                'action' => 'set',
                'path' => '/users/carol/private.txt',
                'kind' => 'member',
                'shareWith' => ['bob' => ['access' => 'view']],
            ])
            ->assertHasErrors(['Cannot share this path']);
    }

    public function test_catalog_hides_drive_write_when_files_disabled(): void
    {
        $this->setAppSetting(WgwSettings::FILES_ENABLED, false);
        $tools = app(McpToolCatalog::class)->enabledTools();
        $this->assertNotContains(DriveWriteTool::class, $tools);
        $this->assertNotContains(DriveShareTool::class, $tools);
    }
}
