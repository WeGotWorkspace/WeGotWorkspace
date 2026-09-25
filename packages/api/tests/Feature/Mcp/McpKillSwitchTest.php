<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Models\McpAuditEvent;
use App\Services\Mcp\CimdException;
use App\Services\Mcp\CimdResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpEnabled;
use App\Services\Mcp\McpScopes;
use App\Services\Mcp\PublicHostResolver;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\Http;
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
            ->assertSee('Connected assistants are turned off', false)
            ->assertDontSee('Connect assistant', false);
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

    public function test_oauth_token_is_forbidden_when_off(): void
    {
        $this->turnMcpOffViaAdminSettings();

        $this->postJson('/oauth/token', [
            'grant_type' => 'authorization_code',
            'client_id' => 'https://metadata.example.test/client.json',
            'code' => 'not-a-code',
            'redirect_uri' => 'https://claude.ai/callback',
            'code_verifier' => 'verifier',
        ])
            ->assertForbidden()
            ->assertJsonPath('error', 'temporarily_unavailable')
            ->assertJsonPath('error_description', 'MCP is disabled by your administrator.');
    }

    public function test_oauth_register_is_forbidden_when_off(): void
    {
        $this->turnMcpOffViaAdminSettings();

        $this->postJson('/oauth/register', [
            'client_name' => 'Claude',
            'client_id' => 'https://metadata.example.test/client.json',
            'redirect_uris' => ['https://claude.ai/callback'],
        ])
            ->assertForbidden()
            ->assertJsonPath('error', 'temporarily_unavailable')
            ->assertJsonPath('error_description', 'MCP is disabled by your administrator.');
    }

    public function test_tool_call_with_token_is_forbidden_when_off(): void
    {
        $this->enableMcp();
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $jwt = $this->mcpBearerToken($user, $client, [McpScopes::DRIVE_READ]);

        $this->turnMcpOffViaAdminSettings();

        $this->withHeaders([
            'Authorization' => 'Bearer '.$jwt,
            'Accept' => 'application/json, text/event-stream',
        ])->postJson('/mcp', [
            'jsonrpc' => '2.0',
            'id' => 7,
            'method' => 'tools/call',
            'params' => [
                'name' => 'drive_read',
                'arguments' => ['path' => '/users/bob/notes.txt'],
            ],
        ])
            ->assertForbidden()
            ->assertJsonPath('error.message', 'MCP is disabled by your administrator.');
    }

    public function test_is_on_reads_only_the_app_setting(): void
    {
        $this->enableMcp();
        $this->withMcpEnvSpoof('false', false, function (): void {
            $this->assertTrue(app(McpEnabled::class)->isOn());
        });

        $this->turnMcpOffViaAdminSettings();
        $this->withMcpEnvSpoof('true', true, function (): void {
            $this->assertFalse(app(McpEnabled::class)->isOn());
        });
    }

    public function test_cimd_sends_no_http_when_off(): void
    {
        $this->turnMcpOffViaAdminSettings();
        $this->app->instance(PublicHostResolver::class, new class extends PublicHostResolver
        {
            public function resolve(string $host): array
            {
                return ['203.0.113.10'];
            }
        });
        Http::fake(fn () => Http::response(['error' => 'should-not-fetch'], 404));

        $metadataUrl = 'https://metadata.example.test/client.json';
        $this->postJson('/oauth/register', [
            'client_name' => 'Claude',
            'client_id' => $metadataUrl,
            'redirect_uris' => ['https://claude.ai/callback'],
        ])->assertForbidden();
        $this->postJson('/oauth/token', [
            'grant_type' => 'authorization_code',
            'client_id' => $metadataUrl,
            'code' => 'not-a-code',
            'redirect_uri' => 'https://claude.ai/callback',
        ])->assertForbidden();
        $this->get('/oauth/authorize?client_id='.rawurlencode($metadataUrl))
            ->assertForbidden();

        try {
            app(CimdResolver::class)->resolve($metadataUrl);
            $this->fail('CIMD resolve must refuse while MCP is off.');
        } catch (CimdException $e) {
            $this->assertSame(403, $e->status());
        }
        try {
            app(CimdResolver::class)->fetch($metadataUrl);
            $this->fail('CIMD fetch must refuse while MCP is off.');
        } catch (CimdException $e) {
            $this->assertSame(403, $e->status());
        }

        Http::assertNothingSent();
    }

    private function turnMcpOffViaAdminSettings(): void
    {
        $this->enableMcp();
        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/settings', [
                'values' => [SettingKeys::MCP_ENABLED => false],
            ])
            ->assertOk();
        $this->assertFalse(app(McpEnabled::class)->isOn());
    }

    /**
     * @param  callable(): void  $assert
     */
    private function withMcpEnvSpoof(string $value, bool $configFlag, callable $assert): void
    {
        $keys = ['MCP_ENABLED', 'WGW_MCP_ENABLED'];
        $saved = [];
        foreach ($keys as $key) {
            $current = getenv($key);
            $saved[$key] = $current === false ? null : $current;
            putenv($key.'='.$value);
            $_ENV[$key] = $value;
            $_SERVER[$key] = $value;
        }
        $previous = config('mcp.enabled');
        config(['mcp.enabled' => $configFlag]);

        try {
            $assert();
        } finally {
            foreach ($keys as $key) {
                if ($saved[$key] === null) {
                    putenv($key);
                    unset($_ENV[$key], $_SERVER[$key]);
                } else {
                    putenv($key.'='.$saved[$key]);
                    $_ENV[$key] = $saved[$key];
                    $_SERVER[$key] = $saved[$key];
                }
            }
            config(['mcp.enabled' => $previous]);
        }
    }
}
