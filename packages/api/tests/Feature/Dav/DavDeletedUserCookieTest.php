<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\User;
use App\Services\Auth\UiSessionService;
use App\Support\WgwSettings;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class DavDeletedUserCookieTest extends WgwDatabaseTestCase
{
    private string $dataDir;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seedWgwUser('bob', displayName: 'Bob');

        $installRoot = sys_get_temp_dir().'/wgw-h3-cookie-'.uniqid('', true);
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

    public function test_h3_deleted_user_cookie_is_rejected(): void
    {
        $realm = (string) (WgwSettings::normalized()[WgwSettings::AUTH_REALM] ?? 'SabreDAV');
        $cookie = $this->app->make(UiSessionService::class)->buildCookie('bob', $realm, '/');
        User::query()->create([
            'username' => 'alice',
            'digesta1' => '',
            'digest' => password_hash('secret', PASSWORD_DEFAULT),
            'enabled' => true,
        ]);
        User::query()->where('username', 'bob')->delete();

        $_COOKIE['sabre_ui_auth'] = $cookie->getValue();
        try {
            $this->withUnencryptedCookie('sabre_ui_auth', $cookie->getValue())
                ->call('PROPFIND', '/files', [], [], [], [
                    'HTTP_DEPTH' => '0',
                    'HTTP_ACCEPT' => '*/*',
                ])
                ->assertStatus(401);
        } finally {
            unset($_COOKIE['sabre_ui_auth']);
        }
    }
}
