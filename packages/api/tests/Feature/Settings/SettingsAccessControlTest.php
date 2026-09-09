<?php

declare(strict_types=1);

namespace Tests\Feature\Settings;

use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ConfiguresMcp;
use Tests\Support\SettingsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class SettingsAccessControlTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use SettingsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSettingsFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownSettingsFixtures();
        parent::tearDown();
    }

    /**
     * @return iterable<string, array{0: string, 1: string, 2: array<string, mixed>|null}>
     */
    public static function guestSettingsRoutesProvider(): iterable
    {
        yield 'GET state' => ['GET', '/api/v1/settings/state', null];
        yield 'PUT profile' => ['PUT', '/api/v1/settings/profile', ['displayName' => 'Guest']];
        yield 'PUT mail' => ['PUT', '/api/v1/settings/mail', ['imapUsername' => 'guest@example.test', 'imapPassword' => 'secret']];
        yield 'GET mcp grants' => ['GET', '/api/v1/settings/mcp-grants', null];
        yield 'DELETE mcp grant' => ['DELETE', '/api/v1/settings/mcp-grants/00000000-0000-0000-0000-000000000000', null];
    }

    #[DataProvider('guestSettingsRoutesProvider')]
    public function test_guest_settings_routes_return_unauthorized(string $method, string $uri, ?array $body): void
    {
        if ($method === 'GET') {
            $this->getJson($uri)->assertUnauthorized();
        } else {
            $this->json($method, $uri, $body ?? [])->assertUnauthorized();
        }
    }

    public function test_regular_user_can_read_and_update_own_settings(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.username', 'bob');

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'displayName' => 'Bob Self',
        ])
            ->assertOk()
            ->assertJsonPath('user.username', 'bob')
            ->assertJsonPath('user.displayName', 'Bob Self');
    }

    public function test_admin_can_read_and_update_own_settings_not_other_users(): void
    {
        $adminToken = $this->adminBearerToken();

        $this->withBearer($adminToken)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.username', 'alice');

        $this->withBearer($adminToken)->putJson('/api/v1/settings/profile', [
            'displayName' => 'Alice Admin',
        ])
            ->assertOk()
            ->assertJsonPath('user.username', 'alice')
            ->assertJsonPath('user.displayName', 'Alice Admin');

        $bobState = $this->withBearer($this->userBearerToken())->getJson('/api/v1/settings/state');
        $bobState->assertOk()->assertJsonPath('user.displayName', 'Bob');
    }

    public function test_regular_user_settings_state_includes_mcp_enabled_without_admin_api(): void
    {
        $token = $this->userBearerToken();

        $this->disableMcp();
        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.username', 'bob')
            ->assertJsonPath('mcpEnabled', false);

        $this->enableMcp();
        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('mcpEnabled', true);
    }
}
