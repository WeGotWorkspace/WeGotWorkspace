<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Models\McpAuditEvent;
use App\Services\Mcp\ConsentIntent;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpOAuthSubscriber;
use App\Services\Mcp\McpScopes;
use Laravel\Passport\Events\AccessTokenCreated;
use Laravel\Passport\Events\RefreshTokenCreated;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\SettingsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class McpConsentAndGrantsTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use SettingsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSettingsFixtures();
        $this->enableMcp();
    }

    protected function tearDown(): void
    {
        $this->tearDownSettingsFixtures();
        parent::tearDown();
    }

    public function test_consent_login_without_intent_is_forbidden(): void
    {
        $this->post('/oauth/session', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertForbidden();
    }

    public function test_consent_login_with_forged_origin_is_forbidden(): void
    {
        $intent = app(ConsentIntent::class)->issue('_login', 'session');
        $this->withHeaders(['Origin' => 'https://evil.example'])
            ->post('/oauth/session', [
                'username' => 'bob',
                'password' => 'secret',
                'intent' => $intent,
            ])
            ->assertForbidden();
    }

    public function test_consent_login_with_valid_intent_signs_in(): void
    {
        $intent = app(ConsentIntent::class)->issue('_login', 'session');
        $this->post('/oauth/session', [
            'username' => 'bob',
            'password' => 'secret',
            'intent' => $intent,
        ])->assertRedirect();
        $this->assertAuthenticatedAs($this->mcpUser('bob'), 'web');
    }

    public function test_authorize_approve_without_intent_is_forbidden(): void
    {
        $user = $this->mcpUser('bob');
        $this->actingAs($user, 'web');
        $this->post('/oauth/authorize', [
            'client_id' => 'not-a-client',
            'auth_token' => 'nope',
        ])->assertForbidden();
    }

    public function test_list_and_revoke_grants(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient('Claude', 'https://claude.ai');
        $this->issueMcpGrant($user, $client, [McpScopes::DRIVE, McpScopes::MAIL_READ]);

        $token = $this->userBearerToken();
        $list = $this->withBearer($token)->getJson('/api/v1/settings/mcp-grants');
        $list->assertOk()
            ->assertJsonPath('grants.0.clientOrigin', 'https://claude.ai')
            ->assertJsonPath('grants.0.clientName', 'Claude');
        $this->assertContains(McpScopes::DRIVE, $list->json('grants.0.scopes'));

        $clientId = $list->json('grants.0.clientId');
        $this->withBearer($token)
            ->deleteJson('/api/v1/settings/mcp-grants/'.$clientId)
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->getJson('/api/v1/settings/mcp-grants')
            ->assertOk()
            ->assertJsonPath('grants', []);

        $this->assertSame(
            1,
            McpAuditEvent::query()->where('event_type', McpAuditLogger::GRANT_REVOKED)->count(),
        );
    }

    public function test_offline_access_is_required_to_keep_refresh_tokens(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $accessId = $this->issueMcpGrant($user, $client, [McpScopes::DRIVE]);
        $refreshId = bin2hex(random_bytes(40));
        Passport::refreshToken()->newQuery()->create([
            'id' => $refreshId,
            'access_token_id' => $accessId,
            'revoked' => false,
            'expires_at' => now()->addDays(30),
        ]);

        app(McpOAuthSubscriber::class)->handleRefreshTokenCreated(new RefreshTokenCreated($refreshId, $accessId));
        $this->assertNull(Passport::refreshToken()->newQuery()->find($refreshId));

        $accessWithOffline = $this->issueMcpGrant($user, $client, [McpScopes::DRIVE, McpScopes::OFFLINE_ACCESS]);
        $keepId = bin2hex(random_bytes(40));
        Passport::refreshToken()->newQuery()->create([
            'id' => $keepId,
            'access_token_id' => $accessWithOffline,
            'revoked' => false,
            'expires_at' => now()->addDays(30),
        ]);
        app(McpOAuthSubscriber::class)->handleRefreshTokenCreated(new RefreshTokenCreated($keepId, $accessWithOffline));
        $this->assertNotNull(Passport::refreshToken()->newQuery()->find($keepId));
    }

    public function test_access_token_created_is_audited(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $tokenId = $this->issueMcpGrant($user, $client);
        app(McpOAuthSubscriber::class)->handleAccessTokenCreated(new AccessTokenCreated(
            $tokenId,
            (string) $user->getAuthIdentifier(),
            (string) $client->getKey(),
        ));

        $this->assertSame(
            1,
            McpAuditEvent::query()->where('event_type', McpAuditLogger::GRANT_CREATED)->where('username', 'bob')->count(),
        );
    }
}
