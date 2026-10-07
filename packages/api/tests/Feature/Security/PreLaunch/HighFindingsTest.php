<?php

declare(strict_types=1);

namespace Tests\Feature\Security\PreLaunch;

use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\OutboundMessageMail;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\Mail;
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

    /** H1: the reset link must not follow the attacker's Host header. */
    public function test_h1_password_reset_link_ignores_the_request_host(): void
    {
        Mail::fake();
        config(['app.url' => 'https://wgw.example.test']);
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);

        $this->postJson('http://attacker.example/api/v1/auth/password-resets', ['identifier' => 'bob'])
            ->assertOk();

        $bodies = [];
        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail) use (&$bodies): bool {
            $bodies[] = (string) $mail->outbound->textBody;

            return true;
        });
        $this->assertNotEmpty($bodies, 'No reset mail was sent.');
        $body = implode("\n", $bodies);

        $this->assertStringNotContainsString('attacker.example', $body, 'Reset link points at the attacker-controlled Host header.');
        $this->assertStringContainsString('https://wgw.example.test/', $body);
    }

    public function test_h1_unset_app_url_sends_no_reset_mail(): void
    {
        Mail::fake();
        config(['app.url' => 'http://localhost']);
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'bob'])
            ->assertOk();

        Mail::assertNothingSent();
    }

    public function test_h1_reset_link_includes_the_install_base_path(): void
    {
        Mail::fake();
        config(['app.url' => 'https://host.example']);
        $this->setAppSetting(SettingKeys::BASE_URI, '/wgw/');
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'bob'])
            ->assertOk();

        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            $this->assertStringContainsString('https://host.example/wgw/login/reset?token=', (string) $mail->outbound->textBody);
            $this->assertStringNotContainsString('https://host.example/login/reset', (string) $mail->outbound->textBody);

            return true;
        });
    }

    /** H2: data and source trees must stay denied even without mod_rewrite. */
    public function test_h2_private_trees_are_denied_without_mod_rewrite(): void
    {
        $htaccess = (string) file_get_contents(base_path('../../apps/wegotworkspace/.htaccess'));
        $outsideRewrite = (string) preg_replace('#<IfModule mod_rewrite\.c>.*?</IfModule>#s', '', $htaccess);

        $this->assertMatchesRegularExpression(
            '#(Require all denied|Deny from all|RedirectMatch\s+40[34])#i',
            $outsideRewrite,
            'wgw-content/ and packages/ are only protected inside <IfModule mod_rewrite.c>; without mod_rewrite (or on nginx) db.sqlite and the JWT private key are downloadable.',
        );
    }

    /** H3a: a deleted user's refresh token must stop working. */
    public function test_h3_deleted_user_cannot_refresh(): void
    {
        $bob = $this->login('bob');

        $this->withBearer($this->login('alice')['access_token'])
            ->deleteJson('/api/v1/admin/users/bob')
            ->assertSuccessful();

        $this->postJson('/api/v1/auth/refresh', ['refresh_token' => $bob['refresh_token']])
            ->assertUnauthorized();
    }

    /** H3b: removing someone from administrators must remove admin access on the next refresh. */
    public function test_h3_demoted_admin_loses_admin_on_refresh(): void
    {
        $alice = $this->login('alice');
        $this->seedWgwUser('carol', displayName: 'Carol');
        $carolPrincipal = Principal::forUsername('carol');
        $this->assertNotNull($carolPrincipal);
        $admins = Principal::query()->where('uri', AdminRoleResolver::ADMIN_GROUP_URI)->firstOrFail();
        $this->addPrincipalToGroup($admins, $carolPrincipal);

        // carol (second admin) demotes alice.
        $this->withBearer($this->login('carol')['access_token'])
            ->deleteJson('/api/v1/admin/groups/administrators/members/alice')
            ->assertOk();

        $refreshed = $this->postJson('/api/v1/auth/refresh', ['refresh_token' => $alice['refresh_token']]);
        if ($refreshed->status() === 401) {
            $this->assertTrue(true);

            return;
        }
        $refreshed->assertOk();
        $this->assertNotSame('admin', $refreshed->json('role'), 'Refresh re-issued the stale admin role.');
        $this->withBearer((string) $refreshed->json('access_token'))
            ->getJson('/api/v1/admin/state')
            ->assertForbidden();
    }

    /** H3c: an admin password change must revoke the user's existing sessions. */
    public function test_h3_admin_password_change_revokes_sessions(): void
    {
        $bob = $this->login('bob');

        $this->withBearer($this->login('alice')['access_token'])
            ->patchJson('/api/v1/admin/users/bob', ['password' => 'a-brand-new-password'])
            ->assertSuccessful();

        $this->postJson('/api/v1/auth/refresh', ['refresh_token' => $bob['refresh_token']])
            ->assertUnauthorized();
    }

    /** H3d: a disabled user's existing MCP (Passport) identity must not resolve. */
    public function test_h3_disabled_user_is_not_resolved_for_mcp_tokens(): void
    {
        $this->withBearer($this->login('alice')['access_token'])
            ->patchJson('/api/v1/admin/users/bob', ['enabled' => false])
            ->assertSuccessful();

        $provider = auth()->createUserProvider('users');
        $this->assertNotNull($provider);
        $bob = User::query()->where('username', 'bob')->firstOrFail();

        $this->assertNull(
            $provider->retrieveById($bob->getAuthIdentifier()),
            'SabreUserProvider::retrieveById() returns disabled users, so existing Passport tokens keep working.',
        );
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
        config(['app.debug' => false, 'app.url' => 'https://wgw.example.test']);
        $this->app->make('url')->forceRootUrl('https://wgw.example.test');
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

        config(['app.debug' => false, 'app.url' => 'http://localhost']);
        $this->app->make('url')->forceRootUrl('http://localhost');
        $this->app['env'] = 'production';
        $unset = $this->withBearer($this->login('alice')['access_token'])
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->json('securityWarnings');
        $this->assertIsArray($unset);
        $this->assertContains(
            'APP_URL is not set; the Host header is not validated and password-reset mail is disabled.',
            $unset,
        );
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
