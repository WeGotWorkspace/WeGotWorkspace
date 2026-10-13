<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Ui\UiStaticServer;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ConfiguresMcp;
use Tests\Support\UiDistFixture;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

final class McpFrontDoorTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;

    private ?string $repoRoot = null;

    protected function tearDown(): void
    {
        if ($this->repoRoot !== null) {
            UiDistFixture::removeTree($this->repoRoot);
            $this->repoRoot = null;
        }

        parent::tearDown();
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function reservedPathProvider(): array
    {
        return [
            'mcp get' => ['GET', '/mcp'],
            'mcp propfind' => ['PROPFIND', '/mcp'],
            'oauth authorize' => ['GET', '/oauth/authorize'],
            'oauth token' => ['POST', '/oauth/token'],
            'well known as' => ['GET', '/.well-known/oauth-authorization-server'],
            'well known prm' => ['GET', '/.well-known/oauth-protected-resource'],
            'well known prm suffix' => ['GET', '/.well-known/oauth-protected-resource/mcp'],
        ];
    }

    #[DataProvider('reservedPathProvider')]
    public function test_mcp_and_oauth_paths_do_not_fall_through_to_sabredav(string $method, string $path): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $response = $this->call($method, $path, [], [], [], ['HTTP_ACCEPT' => '*/*']);
        $body = (string) $response->getContent();

        $this->assertStringNotContainsString('Sabre\\DAV\\Exception\\NotFound', $body);
        $this->assertStringNotContainsString('File not found:', $body);
        $this->assertStringNotContainsString('<d:error', $body);
        $this->assertNotSame(207, $response->getStatusCode());
    }

    public function test_mcp_is_not_on_the_spa_shell_allowlist(): void
    {
        $this->assertNotContains('/mcp', UiStaticServer::spaRoutePrefixes());
        $this->assertNotContains('/oauth', UiStaticServer::spaRoutePrefixes());
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
        $this->allowMcpPublicMetadata();
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
        $this->allowMcpPublicMetadata();
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
        $this->allowMcpPublicMetadata();
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

    private function allowMcpPublicMetadata(): void
    {
        config([
            'app.env' => 'testing',
            'wgw.mcp.public_origin' => null,
        ]);
        $this->enableMcp();
    }
}
