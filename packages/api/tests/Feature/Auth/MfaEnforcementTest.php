<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\AppSetting;
use App\Models\Principal;
use App\Models\User;
use App\Models\UserMfa;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Auth\MfaEnforcement;
use App\Services\Auth\RecoveryCodeService;
use App\Services\Auth\TotpService;
use App\Services\Auth\UserMfaService;
use App\Services\Settings\SettingKeys;
use App\Support\WgwSettings;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class MfaEnforcementTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);

        $installRoot = sys_get_temp_dir().'/wgw-mfa-enf-'.uniqid('', true);
        File::ensureDirectoryExists($installRoot.'/wgw-plugins/demo-plugin/assets');
        File::put($installRoot.'/index.php', "<?php\n");
        File::put($installRoot.'/wgw-plugins/demo-plugin/assets/index.html', '<!doctype html><title>Plugin</title>');
        File::put($installRoot.'/wgw-plugins/demo-plugin/plugin.json', json_encode([
            'id' => 'demo-plugin',
            'name' => 'Demo plugin',
            'active' => true,
            'appTile' => ['id' => 'demo', 'label' => 'Demo', 'route' => '/apps/demo-editor'],
            'integration' => ['sessionApiPath' => '/api/v1/plugins/demo-plugin/session'],
        ], JSON_THROW_ON_ERROR));
        $this->dataDir = $installRoot.'/wgw-content';
        File::ensureDirectoryExists($this->dataDir.'/files/users/alice');
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'alice');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        $this->seedWgwUser('bob', displayName: 'Bob');
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $group = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($group, $alice);
        WgwTestDisks::refresh($this->dataDir);
        unset($_COOKIE['sabre_ui_auth']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        if ($this->dataDir !== '' && File::isDirectory(dirname($this->dataDir))) {
            File::deleteDirectory(dirname($this->dataDir));
        }
        parent::tearDown();
    }

    public function test_enforcement_blocks_user_routes_and_leaves_me_open(): void
    {
        $token = $this->issueBearerTokenFor('bob');
        AppSetting::setValue(SettingKeys::AUTH_MFA_REQUIRED, true);

        $this->withBearer($token)->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('mfa.required', true)
            ->assertJsonPath('mfa.enabled', false)
            ->assertJsonPath('mfa.suggest', true);

        $this->flushHeaders();
        $this->withBearer($token)->getJson('/api/v1/workspace/state')
            ->assertForbidden()
            ->assertJsonPath('code', 'mfa_setup_required');
    }

    public function test_enforce_without_own_totp_is_rejected(): void
    {
        $token = $this->issueBearerTokenFor('alice');

        $this->withBearer($token)->putJson('/api/v1/admin/mfa-enforcement', [
            'required' => true,
            'code' => '123456',
        ])->assertStatus(422)->assertJsonPath('code', 'admin_mfa_required');
    }

    public function test_enable_reissues_the_session_and_matches_the_plugin_cookie_path(): void
    {
        Storage::disk('wgw_files')->put('users/alice/note.txt', 'hello');
        $oldToken = $this->issueBearerTokenFor('alice');
        $plugin = $this->withBearer($oldToken)->postJson('/api/v1/plugins/demo-plugin/session')->assertOk();
        $oldCookie = $this->cookieNamed($plugin, 'sabre_ui_auth');
        $this->assertNotNull($oldCookie);

        $this->flushHeaders();
        $secret = (string) $this->withBearer($oldToken)->postJson('/api/v1/settings/totp', [
            'password' => 'secret',
        ])->json('secret');
        $confirmed = $this->withBearer($oldToken)->postJson('/api/v1/settings/totp/confirmation', [
            'code' => $this->otp($secret),
            'password' => 'secret',
        ])->assertOk();
        $confirmed->assertJsonPath('status', 'ok');
        $this->assertNotSame('', (string) $confirmed->json('access_token'));
        $newCookie = $this->cookieNamed($confirmed, 'sabre_ui_auth');
        $this->assertNotNull($newCookie);
        $this->assertSame($oldCookie->getPath(), $newCookie->getPath());

        $this->flushHeaders();
        $this->withBearer($oldToken)->getJson('/api/v1/me')->assertUnauthorized();
        $this->flushHeaders();
        $this->withBearer((string) $confirmed->json('access_token'))->getJson('/api/v1/me')->assertOk();

        $this->withUnencryptedCookie('sabre_ui_auth', $oldCookie->getValue())
            ->call('PROPFIND', '/files', [], [], [], ['HTTP_DEPTH' => '0'])
            ->assertUnauthorized();
        $_COOKIE['sabre_ui_auth'] = $oldCookie->getValue();
        $this->call('PROPFIND', '/files', [], [], [], ['HTTP_DEPTH' => '0'])->assertUnauthorized();
        $_COOKIE['sabre_ui_auth'] = $newCookie->getValue();
        $this->get('/files/users/alice/note.txt')->assertSuccessful();
        unset($_COOKIE['sabre_ui_auth']);
    }

    public function test_old_refresh_after_totp_enable_does_not_revoke_the_new_pair(): void
    {
        $issued = $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ])->assertOk();
        $access = (string) $issued->json('access_token');
        $oldRefresh = (string) $issued->json('refresh_token');

        $secret = (string) $this->withBearer($access)->postJson('/api/v1/settings/totp', [
            'password' => 'secret',
        ])->json('secret');
        $confirmed = $this->withBearer($access)->postJson('/api/v1/settings/totp/confirmation', [
            'code' => $this->otp($secret),
            'password' => 'secret',
        ])->assertOk();
        $newRefresh = (string) $confirmed->json('refresh_token');
        $this->assertNotSame('', $newRefresh);
        $this->assertNotSame($oldRefresh, $newRefresh);

        $this->postJson('/api/v1/auth/refresh', [
            'refresh_token' => $oldRefresh,
        ])->assertUnauthorized();

        $this->postJson('/api/v1/auth/refresh', [
            'refresh_token' => $newRefresh,
        ])->assertOk();
    }

    public function test_replace_confirmation_rejects_the_previous_bearer_and_cookie(): void
    {
        Storage::disk('wgw_files')->put('users/alice/note.txt', 'hello');
        $oldToken = $this->issueBearerTokenFor('alice');
        $secret = (string) $this->withBearer($oldToken)->postJson('/api/v1/settings/totp', [
            'password' => 'secret',
        ])->json('secret');
        $confirmed = $this->withBearer($oldToken)->postJson('/api/v1/settings/totp/confirmation', [
            'code' => $this->otp($secret),
            'password' => 'secret',
        ])->assertOk();
        $previousToken = (string) $confirmed->json('access_token');
        $previousCookie = $this->cookieNamed($confirmed, 'sabre_ui_auth');
        $this->assertNotNull($previousCookie);
        $codes = $confirmed->json('recovery_codes');
        $this->assertIsArray($codes);

        $this->flushHeaders();
        $challenge = (string) $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ])->assertJsonPath('status', 'mfa_required')->json('challenge');
        $this->postJson('/api/v1/auth/mfa-challenges/'.$challenge.'/verification', [
            'recovery_code' => $codes[0],
        ])->assertJsonPath('status', 'mfa_replace_required');
        $pending = (string) $this->postJson('/api/v1/auth/mfa-challenges/'.$challenge.'/totp')->json('secret');
        $replaced = $this->postJson('/api/v1/auth/mfa-challenges/'.$challenge.'/confirmation', [
            'code' => $this->otp($pending),
        ])->assertOk();
        $newCookie = $this->cookieNamed($replaced, 'sabre_ui_auth');
        $this->assertNotNull($newCookie);

        $this->withBearer($previousToken)->getJson('/api/v1/me')->assertUnauthorized();
        $_COOKIE['sabre_ui_auth'] = $previousCookie->getValue();
        $this->call('PROPFIND', '/files', [], [], [], ['HTTP_DEPTH' => '0'])->assertUnauthorized();
        $_COOKIE['sabre_ui_auth'] = $newCookie->getValue();
        $this->get('/files/users/alice/note.txt')->assertSuccessful();
        unset($_COOKIE['sabre_ui_auth']);
    }

    public function test_artisan_enforce_and_reset(): void
    {
        $this->enableTotp('bob');
        $generation = (int) User::query()->where('username', 'bob')->value('session_generation');

        Artisan::call('wgw:mfa:enforce', ['state' => 'on']);
        $this->assertTrue(app(MfaEnforcement::class)->isRequired());

        Artisan::call('wgw:mfa:reset', ['username' => 'bob']);
        $this->assertFalse(app(UserMfaService::class)->isEnabled('bob'));
        $this->assertSame(0, app(RecoveryCodeService::class)->remaining('bob'));
        $this->assertGreaterThan($generation, (int) User::query()->where('username', 'bob')->value('session_generation'));

        Artisan::call('wgw:mfa:enforce', ['state' => 'off']);
        $this->assertFalse(app(MfaEnforcement::class)->isRequired());
    }

    public function test_profile_password_change_revokes_refresh_tokens(): void
    {
        $issued = $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertOk();
        $access = (string) $issued->json('access_token');
        $refresh = (string) $issued->json('refresh_token');

        $changed = $this->withBearer($access)->putJson('/api/v1/settings/profile', [
            'password' => 'newpassword12',
        ])->assertOk();
        $fresh = (string) $changed->json('access_token');
        $this->assertNotSame('', $fresh);
        $changed->assertCookie('sabre_ui_auth');

        $this->postJson('/api/v1/auth/refresh', [
            'refresh_token' => $refresh,
        ])->assertUnauthorized();
        $this->flushHeaders();
        $this->withBearer($access)->getJson('/api/v1/me')->assertUnauthorized();
        $this->flushHeaders();
        $this->withBearer($fresh)->getJson('/api/v1/me')->assertOk();
        $this->assertGreaterThan(0, (int) User::query()->where('username', 'bob')->value('session_generation'));
    }

    private function enableTotp(string $username): string
    {
        $secret = app(TotpService::class)->generateSecret();
        UserMfa::query()->create([
            'username' => $username,
            'totp_secret' => $secret,
            'enabled_at' => Carbon::now(),
        ]);

        return $secret;
    }

    private function otp(string $secret, int $offset = 0): string
    {
        $engine = new Google2FA;
        $step = (int) floor(Carbon::now()->getTimestamp() / 30) + $offset;

        return $engine->oathTotp($secret, $step);
    }

    private function cookieNamed(TestResponse $response, string $name): ?Cookie
    {
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === $name) {
                return $cookie;
            }
        }

        return null;
    }
}
