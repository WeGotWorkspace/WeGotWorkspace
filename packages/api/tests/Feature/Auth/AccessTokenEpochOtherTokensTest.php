<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Services\Auth\UserSessionRevoker;
use App\Services\Mcp\McpScopes;
use Illuminate\Testing\TestResponse;
use Tests\Support\ConfiguresMcp;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #2315: the access-token epoch only applies to member JWTs. Share-link guests
 * and MCP (Passport) tokens keep working as before.
 */
final class AccessTokenEpochOtherTokensTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use DriveTestFixtures;

    private const SHARE_ROOT = '/users/bob/workspace';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_share_guest_token_survives_the_owner_signing_out_everywhere(): void
    {
        $owner = $this->userBearerToken();
        $this->createDriveDirectory('/users/bob', 'workspace');
        $this->createDriveFile($owner, self::SHARE_ROOT, 'plan.md');
        $publicToken = (string) $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => self::SHARE_ROOT,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.publicToken');
        $guest = (string) $this->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])
            ->assertOk()
            ->json('access_token');

        app(UserSessionRevoker::class)->revokeAll('bob');

        $this->withBearer($owner)->getJson('/api/v1/me')->assertUnauthorized();
        $this->withBearer($guest)->getJson('/api/v1/files/children?path='.self::SHARE_ROOT)->assertOk();
    }

    public function test_mcp_token_survives_an_epoch_bump_and_ends_with_revoke_all(): void
    {
        $this->enableMcp();
        $user = $this->mcpUser('bob');
        $jwt = $this->mcpBearerToken($user, $this->mcpClient(), [McpScopes::SETTINGS]);

        // Signing out one browser bumps the epoch; the assistant stays connected.
        app(UserSessionRevoker::class)->bumpEpoch('bob');
        $this->mcpInitialize($jwt)->assertOk();
        // The test app keeps the resolved api guard user between requests.
        $this->app['auth']->forgetGuards();

        // Sign out everywhere revokes the Passport grant, as before.
        app(UserSessionRevoker::class)->revokeAll('bob');
        $this->mcpInitialize($jwt)->assertUnauthorized();
    }

    private function mcpInitialize(string $jwt): TestResponse
    {
        return $this->withHeaders([
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
        ]);
    }
}
