<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Models\McpAuditEvent;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpEnabled;
use App\Services\Mcp\McpScopes;
use App\Services\Settings\SettingKeys;
use Laravel\Passport\Passport;
use Tests\Support\AdminTestFixtures;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;

final class McpKillSwitchTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;
    use ConfiguresMcp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
        $this->disableMcp();
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_authorize_renders_disabled_page_when_off(): void
    {
        $this->get('/oauth/authorize')
            ->assertForbidden()
            ->assertSee('Connected assistants are turned off', false);
    }

    public function test_mcp_jsonrpc_is_forbidden_when_off(): void
    {
        $this->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize'])
            ->assertForbidden()
            ->assertJsonPath('error.message', 'MCP is disabled by your administrator.');
    }

    public function test_well_known_is_forbidden_when_off(): void
    {
        $this->getJson('/.well-known/oauth-authorization-server')
            ->assertForbidden()
            ->assertJsonPath('error', 'temporarily_unavailable');
        $this->getJson('/.well-known/oauth-protected-resource')
            ->assertForbidden();
    }

    public function test_disabling_mcp_revokes_outstanding_tokens_and_audits(): void
    {
        $this->enableMcp();
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $tokenId = $this->issueMcpGrant($user, $client, [McpScopes::DRIVE]);

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/settings', [
                'values' => [SettingKeys::MCP_ENABLED => false],
            ])
            ->assertOk();

        $this->assertTrue((bool) Passport::token()->newQuery()->find($tokenId)?->revoked);
        $this->assertFalse(app(McpEnabled::class)->isOn());
        $this->assertSame(
            1,
            McpAuditEvent::query()->where('event_type', McpAuditLogger::KILL_SWITCH)->count(),
        );
    }
}
