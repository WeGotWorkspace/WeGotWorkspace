<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use Tests\Support\AdminTestFixtures;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;

final class McpPublicOriginEnvTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;
    use ConfiguresMcp;

    private const TUNNEL = 'https://example.ngrok-free.dev';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->enableMcp();
        $this->setUpAdminFixtures();
        $this->app['env'] = 'testing';
        config([
            'app.env' => 'testing',
            'wgw.mcp.public_origin' => null,
        ]);
    }

    protected function tearDown(): void
    {
        $this->app['env'] = 'testing';
        config([
            'app.env' => 'testing',
            'wgw.mcp.public_origin' => null,
        ]);
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_local_env_advertises_configured_tunnel_when_host_is_localhost(): void
    {
        $this->app['env'] = 'local';
        config([
            'app.env' => 'local',
            'wgw.mcp.public_origin' => self::TUNNEL,
        ]);
        $server = [
            'HTTP_HOST' => 'wegotworkspace.localhost',
            'HTTPS' => 'on',
            'HTTP_ACCEPT' => 'application/json',
        ];

        $www = (string) $this->call('GET', '/mcp', [], [], [], $server)
            ->assertUnauthorized()
            ->headers->get('WWW-Authenticate');
        $this->assertStringContainsString(
            'resource_metadata="'.self::TUNNEL.'/.well-known/oauth-protected-resource/mcp"',
            $www,
        );

        $this->call('GET', '/.well-known/oauth-authorization-server', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('issuer', self::TUNNEL)
            ->assertJsonPath('authorization_endpoint', self::TUNNEL.'/oauth/authorize')
            ->assertJsonPath('token_endpoint', self::TUNNEL.'/oauth/token');

        $this->call('GET', '/.well-known/oauth-protected-resource/mcp', [], [], [], $server)
            ->assertOk()
            ->assertJsonPath('resource', self::TUNNEL.'/mcp')
            ->assertJsonPath('authorization_servers.0', self::TUNNEL);
    }

    public function test_production_ignores_configured_mcp_origin(): void
    {
        $this->app['env'] = 'production';
        config([
            'app.env' => 'production',
            'wgw.mcp.public_origin' => self::TUNNEL,
        ]);
        $origin = 'https://customer.example';

        $this->getJson($origin.'/.well-known/oauth-authorization-server')
            ->assertOk()
            ->assertJsonPath('issuer', $origin)
            ->assertJsonPath('authorization_endpoint', $origin.'/oauth/authorize');

        $this->getJson($origin.'/.well-known/oauth-protected-resource/mcp')
            ->assertOk()
            ->assertJsonPath('resource', $origin.'/mcp')
            ->assertJsonPath('authorization_servers.0', $origin);

        $body = (string) $this->getJson($origin.'/.well-known/oauth-authorization-server')->getContent();
        $this->assertStringNotContainsString('ngrok', $body);
        $this->assertStringNotContainsString(self::TUNNEL, $body);
    }

    public function test_admin_state_returns_configured_endpoint_url_locally(): void
    {
        $this->app['env'] = 'local';
        config([
            'app.env' => 'local',
            'wgw.mcp.public_origin' => self::TUNNEL,
        ]);

        $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('mcp.endpointUrl', self::TUNNEL.'/mcp');
    }

    public function test_admin_state_omits_configured_endpoint_url_in_production(): void
    {
        $this->app['env'] = 'production';
        config([
            'app.env' => 'production',
            'wgw.mcp.public_origin' => self::TUNNEL,
        ]);

        $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('mcp.endpointUrl', null);
    }
}
