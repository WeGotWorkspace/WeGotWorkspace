<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Dav\Auth\UiAuthSecret;
use App\Models\ApiPasswordResetToken;
use App\Services\Auth\PasswordRecoveryService;
use App\Services\Auth\UiSessionService;
use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class DavUiSessionEpochTest extends WgwDatabaseTestCase
{
    private string $dataDir;

    protected function setUp(): void
    {
        parent::setUp();

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');

        $installRoot = sys_get_temp_dir().'/wgw-m2-cookie-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/bob', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'bob');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);

        WgwTestDisks::refresh($this->dataDir);
        unset($_COOKIE['sabre_ui_auth']);
    }

    public function test_revoke_rejects_the_previous_ui_cookie(): void
    {
        $cookie = $this->mintCookie();
        $tokens = $this->login('bob');

        $this->withBearer($tokens['access_token'])
            ->postJson('/api/v1/auth/revoke', ['refresh_token' => $tokens['refresh_token']])
            ->assertOk()
            ->assertCookieExpired('sabre_ui_auth');

        $this->propfind($cookie)->assertStatus(401);
    }

    public function test_password_reset_rejects_the_previous_ui_cookie(): void
    {
        $cookie = $this->mintCookie();
        $token = bin2hex(random_bytes(32));
        ApiPasswordResetToken::query()->create([
            'token_hash' => hash('sha256', $token),
            'username' => 'bob',
            'expires_at' => time() + PasswordRecoveryService::TOKEN_TTL_SECONDS,
        ]);

        $this->postJson('/api/v1/auth/password-resets/'.$token, [
            'password' => 'a-new-password',
        ])->assertOk();

        $this->propfind($cookie)->assertStatus(401);
    }

    public function test_fresh_cookie_after_login_still_works(): void
    {
        $this->login('bob');

        $this->propfind($this->mintCookie())->assertStatus(207);
    }

    public function test_version_1_cookie_is_rejected(): void
    {
        $this->propfind($this->versionOneCookie())->assertStatus(401);
    }

    private function mintCookie(): string
    {
        $realm = (string) (WgwSettings::normalized()[WgwSettings::AUTH_REALM] ?? 'SabreDAV');

        return $this->app->make(UiSessionService::class)->buildCookie('bob', $realm, '/')->getValue();
    }

    private function versionOneCookie(): string
    {
        $secret = UiAuthSecret::read();
        $this->assertNotNull($secret);
        $realm = (string) (WgwSettings::normalized()[WgwSettings::AUTH_REALM] ?? 'SabreDAV');
        $exp = time() + 3600;
        $payload = json_encode([
            'v' => 1,
            'u' => 'bob',
            'r' => $realm,
            'e' => $exp,
            'exp' => $exp,
        ], JSON_THROW_ON_ERROR);
        $b64Payload = rtrim(strtr(base64_encode($payload), '+/', '-_'), '=');
        $sig = rtrim(strtr(base64_encode(hash_hmac('sha256', $b64Payload, $secret, true)), '+/', '-_'), '=');

        return $b64Payload.'.'.$sig;
    }

    private function propfind(string $cookie): TestResponse
    {
        $_COOKIE['sabre_ui_auth'] = $cookie;
        try {
            return $this->withUnencryptedCookie('sabre_ui_auth', $cookie)
                ->call('PROPFIND', '/files', [], [], [], [
                    'HTTP_DEPTH' => '0',
                    'HTTP_ACCEPT' => '*/*',
                ]);
        } finally {
            unset($_COOKIE['sabre_ui_auth']);
        }
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
