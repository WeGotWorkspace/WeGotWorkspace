<?php

declare(strict_types=1);

namespace Tests\Feature\Security\PreLaunch;

use App\Models\Principal;
use App\Services\Auth\AdminRoleResolver;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\WgwDatabaseTestCase;

/**
 * H4 methods copied from the #1140 reference test. They assert the secure
 * outcome and fail while shipped installs stay on APP_ENV=local with debug on.
 */
#[Group('security-review-2026-10')]
final class HighFindingsTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');

        $this->seedWgwUser('alice', email: 'alice@example.test', displayName: 'Alice');
        $this->seedWgwUser('bob', email: 'bob@example.test', displayName: 'Bob');
        $admins = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $this->addPrincipalToGroup($admins, $alice);
    }

    protected function tearDown(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);
        parent::tearDown();
    }

    /** H4: the env file shipped with releases must be production-safe. */
    public function test_h4_shipped_env_example_is_production_safe(): void
    {
        $env = (string) file_get_contents(base_path('.env.example'));

        $this->assertMatchesRegularExpression('/^APP_ENV=production$/m', $env, '.env.example (copied to .env by ZIP and Docker installs) sets APP_ENV=local.');
        $this->assertMatchesRegularExpression('/^APP_DEBUG=false$/m', $env, '.env.example (copied to .env by ZIP and Docker installs) sets APP_DEBUG=true.');
    }

    /** H4: login throttling must not depend on the environment name. */
    public function test_h4_login_throttle_still_applies_when_app_env_is_local(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);
        $this->app['env'] = 'local';

        $statuses = [];
        for ($i = 0; $i < 12; $i++) {
            $statuses[] = $this->postJson('/api/v1/auth/token', [
                'username' => 'bob',
                'password' => 'wrong-'.$i,
            ])->status();
        }

        $this->assertContains(429, $statuses, 'No throttling after 12 wrong passwords: APP_ENV=local disables LoginRateLimiter.');
    }

    /** H4 control: the same loop is throttled when APP_ENV=production (passes on main). */
    public function test_h4_control_login_throttle_applies_in_production(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);
        $this->app['env'] = 'production';

        $statuses = [];
        for ($i = 0; $i < 12; $i++) {
            $statuses[] = $this->postJson('/api/v1/auth/token', [
                'username' => 'bob',
                'password' => 'wrong-'.$i,
            ])->status();
        }

        $this->assertContains(429, $statuses);
    }

    public function test_h4_admin_state_warns_when_debug_is_on_or_env_is_not_production(): void
    {
        config(['app.debug' => false]);
        $this->app['env'] = 'production';

        $quiet = $this->withBearer($this->login('alice')['access_token'])
            ->getJson('/api/v1/admin/state');
        $quiet->assertOk();
        $this->assertSame([], $quiet->json('securityWarnings'));

        config(['app.debug' => true]);
        $this->app['env'] = 'local';

        $warnings = $this->withBearer($this->login('alice')['access_token'])
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->json('securityWarnings');

        $this->assertIsArray($warnings);
        $this->assertNotEmpty($warnings);
        $joined = implode("\n", $warnings);
        $this->assertStringContainsString('APP_DEBUG', $joined);
        $this->assertStringContainsString('production', $joined);
    }

    /**
     * @return array{access_token: string, refresh_token: string}
     */
    private function login(string $username): array
    {
        $response = $this->postJson('/api/v1/auth/token', [
            'username' => $username,
            'password' => 'secret',
        ])->assertOk();

        return [
            'access_token' => (string) $response->json('access_token'),
            'refresh_token' => (string) $response->json('refresh_token'),
        ];
    }
}
