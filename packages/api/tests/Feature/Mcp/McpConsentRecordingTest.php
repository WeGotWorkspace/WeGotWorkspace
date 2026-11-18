<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Models\McpAuditEvent;
use App\Models\McpConsent;
use App\Models\User;
use App\Services\Admin\AdminUserProvisionerService;
use App\Services\Mcp\ConsentIntent;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpConsentRecorder;
use App\Services\Mcp\McpScopes;
use Illuminate\Testing\TestResponse;
use Laravel\Passport\Bridge\Client as BridgeClient;
use Laravel\Passport\Bridge\Scope;
use Laravel\Passport\Bridge\User as BridgeUser;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use League\OAuth2\Server\RequestTypes\AuthorizationRequest;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\ConfiguresMcp;
use Tests\Support\SettingsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Settings → AI assistants: where and when each connection was approved,
 * MCP-only listing, and the connect time of older grants.
 */
final class McpConsentRecordingTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use SettingsTestFixtures;

    private const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

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

    public function test_approve_records_browser_and_time(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $this->freezeSecond();

        $this->decide($user, $client, 'post')->assertRedirect();

        $consent = McpConsent::query()->where('username', 'bob')->sole();
        $this->assertSame((string) $client->getKey(), $consent->client_id);
        $this->assertSame(self::SAFARI_MAC, $consent->user_agent);

        $this->issueMcpGrant($user, $client);
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/settings/mcp-grants')
            ->assertOk()
            ->assertJsonPath('grants.0.approvedUserAgent', self::SAFARI_MAC)
            ->assertJsonPath('grants.0.approvedAt', now()->toIso8601String())
            ->assertJsonPath('grants.0.connectedAt', now()->toIso8601String());
    }

    public function test_deny_records_nothing(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();

        $this->decide($user, $client, 'delete')->assertRedirect();

        $this->assertSame(0, McpConsent::query()->count());
    }

    public function test_new_approval_replaces_the_previous_one(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $this->decide($user, $client, 'post', 'approve-1')->assertRedirect();
        $this->travel(2)->days();
        $this->decide($user, $client, 'post', 'approve-2', 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0')
            ->assertRedirect();

        $consent = McpConsent::query()->sole();
        $this->assertStringContainsString('Firefox/132.0', (string) $consent->user_agent);
    }

    public function test_user_agent_is_capped(): void
    {
        app(McpConsentRecorder::class)->record('bob', 'client-1', str_repeat('a', 2000));

        $this->assertSame(McpConsentRecorder::USER_AGENT_MAX, mb_strlen((string) McpConsent::query()->sole()->user_agent));
    }

    public function test_list_marks_registration_kind(): void
    {
        $user = $this->mcpUser('bob');
        $dcr = $this->mcpClient('Claude Code', 'http://localhost:33418');
        $cimd = $this->mcpClient('Claude', 'https://claude.ai');
        $cimd->forceFill(['cimd_url' => 'https://claude.ai/oauth/mcp-oauth-client-metadata'])->save();
        $this->issueMcpGrant($user, $dcr);
        $this->travel(1)->minutes();
        $this->issueMcpGrant($user, $cimd);

        $grants = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/settings/mcp-grants')
            ->assertOk()
            ->json('grants');

        $byName = array_column($grants, 'clientRegistration', 'clientName');
        $this->assertSame(['Claude' => 'cimd', 'Claude Code' => 'dcr'], $byName);
    }

    public function test_list_skips_non_mcp_oauth_clients(): void
    {
        $user = $this->mcpUser('bob');
        $other = app(ClientRepository::class)->createAuthorizationCodeGrantClient(
            name: 'Some other OAuth app',
            redirectUris: ['https://other.example/callback'],
            confidential: false,
            enableDeviceFlow: false,
        );
        $this->issueMcpGrant($user, $other);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/settings/mcp-grants')
            ->assertOk()
            ->assertJsonPath('grants', []);
    }

    public function test_older_grant_connects_at_first_token_not_last_refresh(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $first = now()->subDays(10)->startOfSecond();
        foreach ([$first, now()->subDay()] as $at) {
            McpAuditEvent::query()->create([
                'event_type' => McpAuditLogger::GRANT_CREATED,
                'username' => 'bob',
                'client_id' => (string) $client->getKey(),
                'outcome' => 'ok',
                'created_at' => $at,
            ]);
        }
        $this->issueMcpGrant($user, $client);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/settings/mcp-grants')
            ->assertOk()
            ->assertJsonPath('grants.0.connectedAt', $first->toIso8601String())
            ->assertJsonPath('grants.0.approvedAt', null)
            ->assertJsonPath('grants.0.approvedUserAgent', null);
    }

    public function test_revoke_forgets_the_consent(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $this->issueMcpGrant($user, $client);
        app(McpConsentRecorder::class)->record('bob', (string) $client->getKey(), self::SAFARI_MAC);

        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/settings/mcp-grants/'.$client->getKey())
            ->assertOk();

        $this->assertSame(0, McpConsent::query()->count());
    }

    public function test_deleting_the_user_forgets_their_consents(): void
    {
        $this->mcpUser('carol');
        app(McpConsentRecorder::class)->record('carol', 'client-1', self::SAFARI_MAC);
        app(McpConsentRecorder::class)->record('bob', 'client-1', self::SAFARI_MAC);

        app(AdminUserProvisionerService::class)->delete('carol');

        $this->assertSame(['bob'], McpConsent::query()->pluck('username')->all());
    }

    /**
     * @return TestResponse<Response>
     */
    private function decide(
        User $user,
        Client $client,
        string $method,
        string $authToken = 'consent-recording',
        string $userAgent = self::SAFARI_MAC,
    ): TestResponse {
        $redirect = 'https://claude.ai/callback';
        $authRequest = new AuthorizationRequest;
        $authRequest->setGrantTypeId('authorization_code');
        $authRequest->setClient(new BridgeClient((string) $client->getKey(), (string) $client->name, [$redirect], false));
        $authRequest->setUser(new BridgeUser((string) $user->getAuthIdentifier()));
        $authRequest->setRedirectUri($redirect);
        $authRequest->setScopes([new Scope(McpScopes::DRIVE_READ)]);
        $verifier = 'consent-recording-verifier-consent-recording';
        $authRequest->setCodeChallenge(rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='));
        $authRequest->setCodeChallengeMethod('S256');

        $this->actingAs($user, 'web');
        $payload = [
            'auth_token' => $authToken,
            'intent' => app(ConsentIntent::class)->issue((string) $user->username, (string) $client->getKey()),
            'client_id' => (string) $client->getKey(),
            'scope' => [McpScopes::DRIVE_READ],
        ];

        return $this->withSession(['authRequest' => serialize($authRequest), 'authToken' => $authToken])
            ->withHeader('User-Agent', $userAgent)
            ->{$method}('/oauth/authorize', $payload);
    }
}
