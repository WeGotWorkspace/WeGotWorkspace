<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Services\Mcp\CimdException;
use App\Services\Mcp\CimdResolver;
use App\Services\Mcp\McpScopes;
use App\Services\Mcp\PublicHostResolver;
use Illuminate\Support\Facades\Http;
use Laravel\Passport\Bridge\Client as BridgeClient;
use Laravel\Passport\Bridge\Scope;
use Laravel\Passport\Bridge\ScopeRepository;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;

final class CimdResolverTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableMcp();
        $this->bindPublicDns(['203.0.113.10']);
    }

    public function test_oversized_client_id_is_rejected_before_fetch(): void
    {
        $url = 'https://metadata.example.test/'.str_repeat('a', CimdResolver::URL_MAX_LENGTH);
        $this->expectException(CimdException::class);
        $this->expectExceptionMessage('maximum length');
        app(CimdResolver::class)->resolve($url);
    }

    public function test_http_metadata_url_is_rejected(): void
    {
        $this->expectException(CimdException::class);
        $this->expectExceptionMessage('https');
        app(CimdResolver::class)->fetch('http://claude.ai/.well-known/oauth-client');
    }

    public function test_localhost_host_is_rejected(): void
    {
        $this->expectException(CimdException::class);
        $this->expectExceptionMessage('not allowed');
        app(CimdResolver::class)->fetch('https://localhost/.well-known/oauth-client');
    }

    public function test_private_dns_is_rejected(): void
    {
        $this->bindPublicDns(['10.1.2.3']);
        $this->expectException(CimdException::class);
        $this->expectExceptionMessage('private or reserved');
        app(CimdResolver::class)->fetch('https://metadata.example.test/client.json');
    }

    public function test_redirects_are_rejected(): void
    {
        Http::fake([
            'https://metadata.example.test/client.json' => Http::response('', 302, ['Location' => 'https://evil.example/steal']),
        ]);

        $this->expectException(CimdException::class);
        $this->expectExceptionMessage('fetch failed');
        app(CimdResolver::class)->fetch('https://metadata.example.test/client.json');
    }

    public function test_non_json_content_type_is_rejected(): void
    {
        Http::fake([
            'https://metadata.example.test/client.json' => Http::response('<html></html>', 200, ['Content-Type' => 'text/html']),
        ]);

        $this->expectException(CimdException::class);
        $this->expectExceptionMessage('application/json');
        app(CimdResolver::class)->fetch('https://metadata.example.test/client.json');
    }

    public function test_oversized_metadata_is_rejected(): void
    {
        Http::fake([
            'https://metadata.example.test/client.json' => Http::response(
                '{"token_endpoint_auth_method":"none","redirect_uris":["https://claude.ai/cb"],"pad":"'.str_repeat('x', 70_000).'"}',
                200,
                ['Content-Type' => 'application/json'],
            ),
        ]);

        $this->expectException(CimdException::class);
        $this->expectExceptionMessage('size limit');
        app(CimdResolver::class)->fetch('https://metadata.example.test/client.json');
    }

    public function test_valid_metadata_materializes_a_passport_client(): void
    {
        Http::fake([
            'https://metadata.example.test/client.json' => Http::response([
                'client_name' => 'AttackerNamedClaude',
                'token_endpoint_auth_method' => 'none',
                'redirect_uris' => ['https://claude.ai/callback', 'http://127.0.0.1:8787/cb'],
            ], 200, ['Content-Type' => 'application/json']),
        ]);

        $client = app(CimdResolver::class)->resolve('https://metadata.example.test/client.json');
        $this->assertSame('AttackerNamedClaude', $client->name);
        $this->assertSame('https://metadata.example.test', $client->cimd_origin);
        $this->assertContains('https://claude.ai/callback', $client->redirect_uris);
        $this->assertContains('http://127.0.0.1:8787/cb', $client->redirect_uris);
        $this->assertContains('calendar.read', $client->scopes);
        $this->assertContains('calendar', $client->scopes);
    }

    public function test_stale_cimd_allowlist_drops_advertised_suite_scopes(): void
    {
        $stale = $this->staleCimdClient();
        $kept = $this->finalizeRequestedScopes($stale, [
            'calendar.read',
            'calendar.write',
            'drive.read',
            'mail.read',
            'settings',
            'offline_access',
        ]);
        $this->assertSame(['mail.read', 'settings', 'offline_access'], $kept);
        $this->assertFalse($stale->hasScope('calendar.read'));
    }

    public function test_cached_cimd_client_picks_up_current_scope_catalog_without_refetch(): void
    {
        Http::fake();
        $stale = $this->staleCimdClient();

        $resolved = app(CimdResolver::class)->resolve('https://metadata.example.test/client.json');
        Http::assertNothingSent();
        $this->assertContains('calendar.read', $resolved->scopes);
        $this->assertContains('drive.write', $resolved->scopes);
        $this->assertContains('notes.read', $resolved->scopes);
        $this->assertContains('meet.write', $resolved->scopes);
        $this->assertContains('calendar', $resolved->scopes);
        $this->assertTrue($resolved->hasScope('calendar.read'));
        $this->assertTrue($resolved->hasScope('mail.read'));
        $this->assertSame(
            ['calendar.read', 'calendar.write', 'drive.read', 'mail.read', 'settings', 'offline_access'],
            $this->finalizeRequestedScopes($resolved, [
                'calendar.read',
                'calendar.write',
                'drive.read',
                'mail.read',
                'settings',
                'offline_access',
            ]),
        );
    }

    public function test_localhost_redirect_in_metadata_is_rejected(): void
    {
        Http::fake([
            'https://metadata.example.test/client.json' => Http::response([
                'token_endpoint_auth_method' => 'none',
                'redirect_uris' => ['http://localhost:8787/cb'],
            ], 200, ['Content-Type' => 'application/json']),
        ]);

        $this->expectException(CimdException::class);
        $this->expectExceptionMessage('disallowed URI');
        app(CimdResolver::class)->resolve('https://metadata.example.test/client.json');
    }

    public function test_dcr_rejects_localhost_hostname_and_accepts_loopback_ip(): void
    {
        $this->postJson('/oauth/register', [
            'client_name' => 'Local',
            'redirect_uris' => ['http://localhost:1234/cb'],
        ])->assertStatus(400)->assertJsonPath('error', 'invalid_redirect_uri');

        $created = $this->postJson('/oauth/register', [
            'client_name' => 'Loopback',
            'redirect_uris' => ['http://127.0.0.1:1234/cb'],
        ])->assertCreated()->assertJsonPath('token_endpoint_auth_method', 'none');
        $dcrClient = Passport::client()->newQuery()->find($created->json('client_id'));
        $this->assertNotNull($dcrClient);
        $this->assertContains('calendar.read', $dcrClient->scopes);
        $this->assertContains('calendar', $dcrClient->scopes);
        $this->assertStringContainsString('calendar.read', (string) $created->json('scope'));
        $this->assertStringNotContainsString(' calendar ', ' '.$created->json('scope').' ');
    }

    public function test_authorization_server_metadata_lists_split_mail_scopes(): void
    {
        $response = $this->getJson('/.well-known/oauth-authorization-server')->assertOk();
        $scopes = $response->json('scopes_supported');
        $this->assertIsArray($scopes);
        foreach (McpScopes::ids() as $scope) {
            $this->assertContains($scope, $scopes);
        }
        $this->assertContains('mail.read', $scopes);
        $this->assertContains('mail.send', $scopes);
        $this->assertContains('calendar.read', $scopes);
        $this->assertContains('calendar.write', $scopes);
        $this->assertContains('notes.read', $scopes);
        $this->assertContains('meet.write', $scopes);
        $this->assertSame(['none'], $response->json('token_endpoint_auth_methods_supported'));
        $this->assertSame(['S256'], $response->json('code_challenge_methods_supported'));
        $this->assertTrue($response->json('client_id_metadata_document_supported'));
    }

    private function staleCimdClient(): Client
    {
        $stale = app(ClientRepository::class)->createAuthorizationCodeGrantClient(
            name: 'Claude',
            redirectUris: ['https://claude.ai/callback'],
            confidential: false,
            enableDeviceFlow: false,
        );
        $stale->forceFill([
            'cimd_url' => 'https://metadata.example.test/client.json',
            'cimd_origin' => 'https://metadata.example.test',
            'cimd_fetched_at' => now(),
            'provider' => 'users',
            'scopes' => ['drive', 'docs', 'calendar', 'tasks', 'mail.read', 'mail.send', 'contacts', 'settings', 'offline_access'],
        ])->save();

        return $stale->refresh();
    }

    /**
     * @param  list<string>  $ids
     * @return list<string>
     */
    private function finalizeRequestedScopes(Client $client, array $ids): array
    {
        $scopes = app(ScopeRepository::class)->finalizeScopes(
            array_map(static fn (string $id): Scope => new Scope($id), $ids),
            'authorization_code',
            new BridgeClient((string) $client->getKey(), (string) $client->name, ['https://claude.ai/callback'], false),
        );

        return array_values(array_map(
            static fn (Scope $scope): string => $scope->getIdentifier(),
            $scopes,
        ));
    }

    /**
     * @param  list<string>  $ips
     */
    private function bindPublicDns(array $ips): void
    {
        $this->app->instance(PublicHostResolver::class, new class($ips) extends PublicHostResolver
        {
            /** @param list<string> $ips */
            public function __construct(private array $ips) {}

            public function resolve(string $host): array
            {
                return $this->ips;
            }
        });
    }
}
