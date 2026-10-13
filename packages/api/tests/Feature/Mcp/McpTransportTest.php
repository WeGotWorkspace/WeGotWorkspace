<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Models\McpSession;
use App\Services\Mcp\McpScopes;
use Laravel\Passport\Passport;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;

final class McpTransportTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->enableMcp();
    }

    public function test_passport_does_not_reject_world_readable_public_keys(): void
    {
        $this->assertFalse(Passport::$validateKeyPermissions);
    }

    public function test_passport_bearer_initialize_returns_server_info(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $jwt = $this->mcpBearerToken($user, $client, [McpScopes::SETTINGS]);

        $this->withHeaders([
            'Authorization' => 'Bearer '.$jwt,
            'Accept' => 'application/json, text/event-stream',
        ])->postJson('/mcp', [
            'jsonrpc' => '2.0',
            'id' => 1,
            'method' => 'initialize',
            'params' => [
                'protocolVersion' => '2025-11-25',
                'capabilities' => [],
                'clientInfo' => ['name' => 'test', 'version' => '1'],
            ],
        ])
            ->assertOk()
            ->assertJsonPath('result.serverInfo.name', 'WeGotWorkspace')
            ->assertJsonPath('result.protocolVersion', '2025-11-25');

        $this->assertSame(1, McpSession::query()->where('user_id', $user->getAuthIdentifier())->count());
    }

    public function test_unauthenticated_post_returns_401_with_prm_challenge(): void
    {
        $response = $this->postJson('/mcp', [
            'jsonrpc' => '2.0',
            'id' => 1,
            'method' => 'initialize',
            'params' => [
                'protocolVersion' => '2025-03-26',
                'capabilities' => [],
                'clientInfo' => ['name' => 'test', 'version' => '1'],
            ],
        ]);

        $response->assertUnauthorized();
        $www = (string) $response->headers->get('WWW-Authenticate');
        $this->assertStringContainsString('resource_metadata=', $www);
        $this->assertStringContainsString('oauth-protected-resource', $www);
        $this->assertSame('*', $response->headers->get('Access-Control-Allow-Origin'));
    }

    public function test_get_mcp_returns_401_with_prm_challenge(): void
    {
        $response = $this->getJson('/mcp');

        $response->assertUnauthorized();
        $response->assertJsonPath('error.code', -32001);
        $www = (string) $response->headers->get('WWW-Authenticate');
        $this->assertStringContainsString('/.well-known/oauth-protected-resource/mcp', $www);
        $this->assertSame('*', $response->headers->get('Access-Control-Allow-Origin'));
    }

    public function test_options_mcp_is_cors_preflight(): void
    {
        $this->call('OPTIONS', '/mcp')
            ->assertStatus(204)
            ->assertHeader('Access-Control-Allow-Origin', '*')
            ->assertHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
    }

    public function test_challenge_and_metadata_use_the_request_host(): void
    {
        $host = 'mcp-tunnel.example.com';
        $origin = 'https://'.$host;

        $www = (string) $this->get($origin.'/mcp')
            ->assertUnauthorized()
            ->headers->get('WWW-Authenticate');
        $this->assertStringContainsString(
            'resource_metadata="'.$origin.'/.well-known/oauth-protected-resource/mcp"',
            $www,
        );

        $this->getJson($origin.'/.well-known/oauth-authorization-server')
            ->assertOk()
            ->assertJsonPath('issuer', $origin)
            ->assertJsonPath('registration_endpoint', $origin.'/oauth/register')
            ->assertJsonPath('client_id_metadata_document_supported', true);

        $this->getJson($origin.'/.well-known/oauth-protected-resource/mcp')
            ->assertOk()
            ->assertJsonPath('resource', $origin.'/mcp')
            ->assertJsonPath('authorization_servers.0', $origin);
    }

    public function test_challenge_and_metadata_use_forwarded_tunnel_host(): void
    {
        $host = 'mcp-tunnel.example.com';
        $origin = 'https://'.$host;
        $server = [
            'HTTP_HOST' => 'wegotworkspace.localhost',
            'HTTP_X_FORWARDED_HOST' => $host,
            'HTTP_X_FORWARDED_PROTO' => 'https',
            'HTTPS' => 'on',
        ];

        $www = (string) $this->call('GET', '/mcp', [], [], [], $server)
            ->assertUnauthorized()
            ->headers->get('WWW-Authenticate');
        $this->assertStringContainsString(
            'resource_metadata="'.$origin.'/.well-known/oauth-protected-resource/mcp"',
            $www,
        );

        $this->call('GET', '/.well-known/oauth-authorization-server', [], [], [], $server + [
            'HTTP_ACCEPT' => 'application/json',
        ])
            ->assertOk()
            ->assertJsonPath('issuer', $origin)
            ->assertJsonPath('token_endpoint', $origin.'/oauth/token');

        $this->call('GET', '/.well-known/oauth-protected-resource/mcp', [], [], [], $server + [
            'HTTP_ACCEPT' => 'application/json',
        ])
            ->assertOk()
            ->assertJsonPath('resource', $origin.'/mcp')
            ->assertJsonPath('authorization_servers.0', $origin);
    }

    /**
     * @return array<string, array{0: array<string, string>}>
     */
    public static function spoofedForwardedHostProvider(): array
    {
        return [
            'x-forwarded-host' => [[
                'HTTP_X_FORWARDED_HOST' => 'evil.example',
                'HTTP_X_FORWARDED_PROTO' => 'https',
            ]],
            'x-original-host' => [[
                'HTTP_X_ORIGINAL_HOST' => 'evil.example',
            ]],
            'forwarded' => [[
                'HTTP_FORWARDED' => 'host=evil.example;proto=https',
            ]],
        ];
    }

    /**
     * @param  array<string, string>  $spoofed
     */
    #[DataProvider('spoofedForwardedHostProvider')]
    public function test_spoofed_forwarded_host_from_an_untrusted_client_does_not_change_metadata(array $spoofed): void
    {
        $this->withoutConfiguredMcpOrigin();
        $real = 'https://wgw.example.test';
        $server = $spoofed + [
            'REMOTE_ADDR' => '203.0.113.9',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $www = (string) $this->call('GET', $real.'/mcp', [], [], [], $server)
            ->assertUnauthorized()
            ->headers->get('WWW-Authenticate');
        $this->assertStringContainsString(
            'resource_metadata="'.$real.'/.well-known/oauth-protected-resource/mcp"',
            $www,
        );
        $this->assertStringNotContainsString('evil.example', $www);

        $authorization = $this->call('GET', $real.'/.well-known/oauth-authorization-server', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('issuer', $real)
            ->assertJsonPath('authorization_endpoint', $real.'/oauth/authorize')
            ->assertJsonPath('token_endpoint', $real.'/oauth/token');
        $this->assertStringNotContainsString('evil.example', (string) $authorization->getContent());

        $protected = $this->call('GET', $real.'/.well-known/oauth-protected-resource/mcp', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('resource', $real.'/mcp')
            ->assertJsonPath('authorization_servers.0', $real);
        $this->assertStringNotContainsString('evil.example', (string) $protected->getContent());
    }

    public function test_forwarded_host_from_a_trusted_proxy_is_honoured(): void
    {
        $this->withoutConfiguredMcpOrigin();
        $origin = 'https://mcp-tunnel.example.com';
        $server = [
            'REMOTE_ADDR' => '127.0.0.1',
            'HTTP_X_FORWARDED_HOST' => 'mcp-tunnel.example.com',
            'HTTP_X_FORWARDED_PROTO' => 'https',
            'HTTP_X_ORIGINAL_HOST' => 'evil.example',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $www = (string) $this->call('GET', 'https://wgw.example.test/mcp', [], [], [], $server)
            ->assertUnauthorized()
            ->headers->get('WWW-Authenticate');
        $this->assertStringContainsString(
            'resource_metadata="'.$origin.'/.well-known/oauth-protected-resource/mcp"',
            $www,
        );
        $this->assertStringNotContainsString('evil.example', $www);

        $this->call('GET', 'https://wgw.example.test/.well-known/oauth-authorization-server', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('issuer', $origin)
            ->assertJsonPath('token_endpoint', $origin.'/oauth/token');

        $this->call('GET', 'https://wgw.example.test/.well-known/oauth-protected-resource/mcp', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('resource', $origin.'/mcp')
            ->assertJsonPath('authorization_servers.0', $origin);
    }

    public function test_original_host_from_a_trusted_proxy_is_honoured_when_forwarded_host_is_absent(): void
    {
        $this->withoutConfiguredMcpOrigin();
        $origin = 'https://original.example.com';
        $server = [
            'REMOTE_ADDR' => '127.0.0.1',
            'HTTP_X_ORIGINAL_HOST' => 'original.example.com',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $this->call('GET', 'https://wgw.example.test/.well-known/oauth-protected-resource/mcp', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('resource', $origin.'/mcp')
            ->assertJsonPath('authorization_servers.0', $origin);

        $www = (string) $this->call('GET', 'https://wgw.example.test/mcp', [], [], [], $server)
            ->assertUnauthorized()
            ->headers->get('WWW-Authenticate');
        $this->assertStringContainsString(
            'resource_metadata="'.$origin.'/.well-known/oauth-protected-resource/mcp"',
            $www,
        );
    }

    public function test_original_host_outside_the_trusted_host_list_is_ignored(): void
    {
        config([
            'app.url' => 'https://wgw.example.test',
            'wgw.mcp.public_origin' => null,
        ]);
        $real = 'https://wgw.example.test';
        $server = [
            'REMOTE_ADDR' => '127.0.0.1',
            'HTTP_X_ORIGINAL_HOST' => 'evil.example',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $www = (string) $this->call('GET', $real.'/mcp', [], [], [], $server)
            ->assertUnauthorized()
            ->headers->get('WWW-Authenticate');
        $this->assertStringContainsString(
            'resource_metadata="'.$real.'/.well-known/oauth-protected-resource/mcp"',
            $www,
        );
        $this->assertStringNotContainsString('evil.example', $www);

        $this->call('GET', $real.'/.well-known/oauth-authorization-server', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('issuer', $real);

        $this->call('GET', $real.'/.well-known/oauth-protected-resource/mcp', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('resource', $real.'/mcp')
            ->assertJsonPath('authorization_servers.0', $real);
    }

    public function test_original_host_on_the_trusted_host_list_is_honoured(): void
    {
        config([
            'app.url' => 'https://wgw.example.test',
            'wgw.trusted_hosts' => 'original.example.com',
            'wgw.mcp.public_origin' => null,
        ]);
        $origin = 'https://original.example.com';
        $server = [
            'REMOTE_ADDR' => '127.0.0.1',
            'HTTP_X_ORIGINAL_HOST' => 'original.example.com',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $this->call('GET', 'https://wgw.example.test/.well-known/oauth-protected-resource/mcp', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('resource', $origin.'/mcp')
            ->assertJsonPath('authorization_servers.0', $origin);
    }

    public function test_forwarded_header_from_a_trusted_proxy_is_ignored(): void
    {
        config([
            'app.url' => 'http://127.0.0.1:9080',
            'wgw.mcp.public_origin' => null,
        ]);
        $real = 'https://wgw.example.test';
        $server = [
            'REMOTE_ADDR' => '127.0.0.1',
            'HTTP_FORWARDED' => 'host=evil.example;proto=https',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $www = (string) $this->call('GET', $real.'/mcp', [], [], [], $server)
            ->assertUnauthorized()
            ->headers->get('WWW-Authenticate');
        $this->assertStringContainsString(
            'resource_metadata="'.$real.'/.well-known/oauth-protected-resource/mcp"',
            $www,
        );
        $this->assertStringNotContainsString('evil.example', $www);

        $this->call('GET', $real.'/.well-known/oauth-protected-resource/mcp', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('resource', $real.'/mcp')
            ->assertJsonPath('authorization_servers.0', $real);
    }

    public function test_original_host_without_forwarded_proto_on_http_defaults_to_https(): void
    {
        config([
            'app.url' => 'http://127.0.0.1:9080',
            'wgw.mcp.public_origin' => null,
        ]);
        $origin = 'https://original.example.com';
        $server = [
            'REMOTE_ADDR' => '127.0.0.1',
            'HTTP_X_ORIGINAL_HOST' => 'original.example.com',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $this->call('GET', 'http://wgw.example.test/.well-known/oauth-protected-resource/mcp', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('resource', $origin.'/mcp')
            ->assertJsonPath('authorization_servers.0', $origin);

        $www = (string) $this->call('GET', 'http://wgw.example.test/mcp', [], [], [], $server)
            ->assertUnauthorized()
            ->headers->get('WWW-Authenticate');
        $this->assertStringContainsString(
            'resource_metadata="'.$origin.'/.well-known/oauth-protected-resource/mcp"',
            $www,
        );
    }

    public function test_original_host_explicit_http_proto_stays_http(): void
    {
        config([
            'app.url' => 'http://127.0.0.1:9080',
            'wgw.mcp.public_origin' => null,
        ]);
        $server = [
            'REMOTE_ADDR' => '127.0.0.1',
            'HTTP_X_ORIGINAL_HOST' => 'original.example.com',
            'HTTP_X_FORWARDED_PROTO' => 'http',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $this->call('GET', 'https://wgw.example.test/.well-known/oauth-protected-resource/mcp', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('resource', 'http://original.example.com/mcp')
            ->assertJsonPath('authorization_servers.0', 'http://original.example.com');
    }

    public function test_ngrok_host_wins_over_app_url_localhost(): void
    {
        config(['app.url' => 'https://wegotworkspace.localhost']);
        $host = 'example.ngrok-free.dev';
        $origin = 'https://'.$host;

        $this->getJson($origin.'/.well-known/oauth-authorization-server')
            ->assertOk()
            ->assertJsonPath('issuer', $origin)
            ->assertJsonPath('authorization_endpoint', $origin.'/oauth/authorize')
            ->assertJsonPath('token_endpoint', $origin.'/oauth/token');

        $this->getJson($origin.'/.well-known/oauth-protected-resource/mcp')
            ->assertOk()
            ->assertJsonPath('resource', $origin.'/mcp')
            ->assertJsonPath('authorization_servers.0', $origin);

        $this->assertStringNotContainsString('wegotworkspace.localhost', (string) $this->getJson(
            $origin.'/.well-known/oauth-authorization-server',
        )->getContent());
    }

    public function test_delete_mcp_is_method_not_allowed(): void
    {
        $this->delete('/mcp')->assertStatus(405);
    }

    public function test_spa_jwt_is_rejected_on_mcp(): void
    {
        $this->seedWgwUser('bob');
        $jwt = $this->issueBearerTokenFor('bob');

        $this->withHeaders(['Authorization' => 'Bearer '.$jwt])
            ->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'])
            ->assertUnauthorized()
            ->assertJsonPath('error.message', 'SPA access tokens are not accepted on /mcp. Complete the OAuth flow.');
    }

    public function test_passport_token_is_rejected_on_rest_api(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::SETTINGS], 'api', $client);

        $this->getJson('/api/v1/settings/state')
            ->assertUnauthorized();
    }

    public function test_oversized_mcp_body_is_rejected(): void
    {
        $user = $this->mcpUser('bob');
        Passport::actingAs($user, [McpScopes::SETTINGS], 'api', $this->mcpClient());

        $this->call(
            'POST',
            '/mcp',
            [],
            [],
            [],
            [
                'HTTP_ACCEPT' => 'application/json',
                'CONTENT_TYPE' => 'application/json',
                'CONTENT_LENGTH' => '2000000',
            ],
            '{"jsonrpc":"2.0","id":1,"method":"ping"}',
        )->assertStatus(413);
    }

    private function withoutConfiguredMcpOrigin(): void
    {
        config([
            'app.env' => 'testing',
            'wgw.mcp.public_origin' => null,
        ]);
    }
}
