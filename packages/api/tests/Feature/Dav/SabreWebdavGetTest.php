<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\User;
use App\Services\Auth\UiSessionService;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class SabreWebdavGetTest extends WgwDatabaseTestCase
{
    private string $dataDir;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seedWgwUser('alice', displayName: 'Alice');

        $installRoot = sys_get_temp_dir().'/wgw-get-root-'.uniqid('', true);
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
        unset($_COOKIE['sabre_ui_auth']);
    }

    public function test_unauthenticated_files_request_includes_www_authenticate(): void
    {
        unset($_COOKIE['sabre_ui_auth']);
        $_SERVER['HTTP_AUTHORIZATION'] = '';
        unset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);

        $response = $this->call('PROPFIND', '/files', [], [], [], [
            'HTTP_DEPTH' => '0',
            'HTTP_ACCEPT' => '*/*',
        ]);

        $response->assertStatus(401);
        $challenge = (string) $response->headers->get('WWW-Authenticate');
        $this->assertStringContainsString('Basic realm="SabreDAV"', $challenge);
    }

    public function test_get_returns_file_body_with_basic_auth(): void
    {
        $payload = 'docx-bytes-'.random_bytes(4);
        Storage::disk('wgw_files')->put('users/alice/basic.docx', $payload);

        $auth = 'Basic '.base64_encode('alice:secret');

        $response = $this->call(
            'GET',
            '/files/users/alice/basic.docx',
            [],
            [],
            [],
            ['HTTP_AUTHORIZATION' => $auth],
        );

        $response->assertSuccessful();
        $this->assertSame($payload, $response->streamedContent());
    }

    public function test_get_returns_file_body_with_ui_auth_cookie(): void
    {
        $payload = 'docx-cookie-'.random_bytes(4);
        Storage::disk('wgw_files')->put('users/alice/cookie.docx', $payload);

        $realm = (string) (WgwSettings::normalized()[WgwSettings::AUTH_REALM] ?? 'SabreDAV');
        $cookie = $this->app->make(UiSessionService::class)->buildCookie('alice', $realm, '/');

        $response = $this->withUnencryptedCookie('sabre_ui_auth', $cookie->getValue())
            ->get('/files/users/alice/cookie.docx');

        $response->assertSuccessful();
        $this->assertSame($payload, $response->streamedContent());
    }

    public function test_propfind_rejects_disabled_user_with_basic_auth(): void
    {
        User::query()->where('username', 'alice')->update(['enabled' => false]);

        $auth = 'Basic '.base64_encode('alice:secret');
        $response = $this->call('PROPFIND', '/files', [], [], [], [
            'HTTP_AUTHORIZATION' => $auth,
            'HTTP_DEPTH' => '0',
            'HTTP_ACCEPT' => '*/*',
        ]);

        $response->assertStatus(401);
    }

    public function test_propfind_rejects_disabled_user_with_still_valid_cookie(): void
    {
        $realm = (string) (WgwSettings::normalized()[WgwSettings::AUTH_REALM] ?? 'SabreDAV');
        $cookie = $this->app->make(UiSessionService::class)->buildCookie('alice', $realm, '/');
        User::query()->where('username', 'alice')->update(['enabled' => false]);

        $_COOKIE['sabre_ui_auth'] = $cookie->getValue();
        $response = $this->withUnencryptedCookie('sabre_ui_auth', $cookie->getValue())
            ->call('PROPFIND', '/files', [], [], [], [
                'HTTP_DEPTH' => '0',
                'HTTP_ACCEPT' => '*/*',
            ]);

        $response->assertStatus(401);
        unset($_COOKIE['sabre_ui_auth']);
    }

    public function test_propfind_succeeds_after_reenable(): void
    {
        User::query()->where('username', 'alice')->update(['enabled' => false]);
        User::query()->where('username', 'alice')->update(['enabled' => true]);

        $auth = 'Basic '.base64_encode('alice:secret');
        $response = $this->call('PROPFIND', '/files', [], [], [], [
            'HTTP_AUTHORIZATION' => $auth,
            'HTTP_DEPTH' => '0',
            'HTTP_ACCEPT' => '*/*',
        ]);

        $response->assertSuccessful();
    }
}
