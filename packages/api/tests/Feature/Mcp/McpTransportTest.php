<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Services\Mcp\McpScopes;
use Laravel\Passport\Passport;
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
        $this->assertStringContainsString('resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"', $www);
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
        $host = 'sheep-nutmeg-zodiac.ngrok-free.dev';
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
}
