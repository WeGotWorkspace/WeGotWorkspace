<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Dav\Auth\UiAuthSecret;
use App\Models\User;
use App\Services\Auth\UiSessionService;
use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class RecreatedUserSessionTest extends WgwDatabaseTestCase
{
    private string $dataDir;

    protected function setUp(): void
    {
        parent::setUp();

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->seedWgwUser('alice', displayName: 'Alice');

        $installRoot = sys_get_temp_dir().'/wgw-uid-session-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/alice', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'alice');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);

        WgwTestDisks::refresh($this->dataDir);
        unset(
            $_COOKIE['sabre_ui_auth'],
            $_SERVER['HTTP_AUTHORIZATION'],
            $_SERVER['REDIRECT_HTTP_AUTHORIZATION'],
            $_SERVER['PHP_AUTH_USER'],
            $_SERVER['PHP_AUTH_PW'],
        );
    }

    public function test_recreated_user_rejects_previous_cookie_and_access_token(): void
    {
        $cookie = $this->mintCookie();
        $accessToken = $this->login('alice')['access_token'];

        $this->recreateAlice();

        $this->propfind($cookie)->assertStatus(401);
        $this->withBearer($accessToken)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_version_2_cookie_is_rejected(): void
    {
        $epoch = (int) User::query()->where('username', 'alice')->value('ui_session_epoch');

        $this->propfind($this->signedCookie(2, 'alice', ['ep' => $epoch, 'uid' => 1]))
            ->assertStatus(401);
    }

    public function test_share_guest_cookie_is_accepted_over_dav(): void
    {
        $username = 'share:'.bin2hex(random_bytes(16));

        $this->propfind($this->signedCookie(3, $username, ['ep' => 0]))
            ->assertStatus(207);
    }

    public function test_build_cookie_throws_when_the_user_does_not_exist(): void
    {
        $this->expectException(\RuntimeException::class);

        $this->app->make(UiSessionService::class)->buildCookie('missing-user', $this->realm(), '/');
    }

    private function mintCookie(): string
    {
        return $this->app->make(UiSessionService::class)
            ->buildCookie('alice', $this->realm(), '/')
            ->getValue();
    }

    /**
     * @param  array<string, int>  $extra
     */
    private function signedCookie(int $version, string $username, array $extra): string
    {
        $secret = UiAuthSecret::read();
        $this->assertNotNull($secret);
        $exp = time() + 3600;
        $payload = json_encode([
            'v' => $version,
            'u' => $username,
            'r' => $this->realm(),
            'e' => $exp,
            'exp' => $exp,
            ...$extra,
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

    private function recreateAlice(): void
    {
        $previousId = (int) User::query()->where('username', 'alice')->value('id');
        User::query()->where('username', 'alice')->delete();
        User::query()->create([
            'username' => 'alice',
            'digesta1' => '',
            'digest' => password_hash('secret', PASSWORD_DEFAULT),
            'enabled' => true,
        ]);
        $nextId = (int) User::query()->where('username', 'alice')->value('id');
        $this->assertNotSame($previousId, $nextId);
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

    private function realm(): string
    {
        return (string) (WgwSettings::normalized()[WgwSettings::AUTH_REALM] ?? 'SabreDAV');
    }
}
