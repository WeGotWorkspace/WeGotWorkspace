<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

final class DavBasicAuthThrottleTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->app['env'] = 'production';
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);

        $installRoot = sys_get_temp_dir().'/wgw-dav-throttle-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users', 0775, true);
        mkdir($dataDir.'/files/groups', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'alice');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        $this->setAppSetting(WgwSettings::AUTH_REALM, 'SabreDAV');
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        unset($_COOKIE['sabre_ui_auth']);
    }

    public function test_failed_dav_basic_auth_returns_429_and_spares_another_user(): void
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $this->dav('alice', 'wrong')->assertStatus(401);
        }

        $locked = $this->dav('alice', 'wrong');
        $locked->assertStatus(429);
        $this->assertNotSame('', (string) $locked->headers->get('Retry-After'));

        for ($attempt = 0; $attempt < 12; $attempt++) {
            $this->dav('bob', 'secret')->assertStatus(207);
        }
    }

    public function test_dav_user_ceiling_does_not_lock_web_login(): void
    {
        foreach ([10, 11, 12] as $host) {
            for ($attempt = 0; $attempt < 10; $attempt++) {
                $this->dav('alice', 'wrong', ['REMOTE_ADDR' => '203.0.113.'.$host])->assertStatus(401);
            }
        }

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.13'])
            ->postJson('/api/v1/auth/token', [
                'username' => 'alice',
                'password' => 'wrong',
            ])
            ->assertStatus(401)
            ->assertJsonPath('code', 'unauthorized');

        $locked = $this->dav('alice', 'wrong', ['REMOTE_ADDR' => '203.0.113.15']);
        $locked->assertStatus(429);
        $this->assertNotSame('', (string) $locked->headers->get('Retry-After'));

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.14'])
            ->postJson('/api/v1/auth/token', [
                'username' => 'bob',
                'password' => 'secret',
            ])
            ->assertOk()
            ->assertJsonPath('username', 'bob');
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(string $username, string $password, array $server = []): TestResponse
    {
        return $this->call('PROPFIND', '/files', [], [], [], array_merge([
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':'.$password),
            'HTTP_DEPTH' => '0',
            'REMOTE_ADDR' => '203.0.113.9',
        ], $server));
    }
}
