<?php

declare(strict_types=1);

namespace Tests\Feature\Plugins;

use App\Models\Principal;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Auth\UiSessionService;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * Default boot. Flag-on coverage lives on the other plugin tests via WithPluginsEnabled.
 * A 404 here is the shipped contract. A 404 on those tests means the env never reached
 * route registration (including config:cache / route:cache).
 */
final class PluginsDisabledByDefaultTest extends WgwDatabaseTestCase
{
    private string $installRoot = '';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $_SERVER['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);

        $this->installRoot = sys_get_temp_dir().'/wgw-plugins-off-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);
        file_put_contents($this->installRoot.'/index.php', "<?php\n");
        $this->dataDir = $this->installRoot.'/wgw-content';
        $pluginRoot = $this->installRoot.'/wgw-plugins/demo-plugin/assets';
        File::ensureDirectoryExists($pluginRoot);
        File::put($pluginRoot.'/index.html', '<!doctype html><title>PLUGIN_HTML_PROBE_9f3a</title>');
        File::put($this->installRoot.'/wgw-plugins/demo-plugin/plugin.json', json_encode([
            'id' => 'demo-plugin',
            'name' => 'Demo plugin',
            'active' => true,
            'appTile' => [
                'id' => 'demo',
                'label' => 'Demo',
                'route' => '/apps/demo-editor',
            ],
        ], JSON_THROW_ON_ERROR));

        WgwInstallFixture::bindInstallRoot($this->installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($this->installRoot, $this->dataDir, 'alice');
        config(['wgw.install_root' => $this->installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->setAppSetting(WgwSettings::FILES_ENABLED, true);

        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $adminGroup = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($adminGroup, $alice);

        WgwTestDisks::refresh($this->dataDir);
        unset($_COOKIE['sabre_ui_auth']);
    }

    protected function tearDown(): void
    {
        unset($_COOKIE['sabre_ui_auth']);
        if ($this->installRoot !== '' && is_dir($this->installRoot)) {
            File::deleteDirectory($this->installRoot);
        }

        parent::tearDown();
    }

    public function test_plugin_routes_and_html_are_absent(): void
    {
        $token = (string) $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ])->assertOk()->json('access_token');

        $client = $this->withBearer($token);
        $client->getJson('/api/v1/plugins')->assertNotFound();
        $client->postJson('/api/v1/plugins/demo-plugin/session')->assertNotFound();
        $client->post('/api/v1/admin/plugins')->assertNotFound();
        $client->putJson('/api/v1/admin/plugins/demo-plugin/activation', [
            'active' => false,
        ])->assertNotFound();

        $realm = (string) (WgwSettings::normalized()[WgwSettings::AUTH_REALM] ?? 'SabreDAV');
        $cookie = $this->app->make(UiSessionService::class)->buildCookie('alice', $realm, '/')->getValue();
        $_COOKIE['sabre_ui_auth'] = $cookie;

        $response = $this->withBearer($token)
            ->withUnencryptedCookie('sabre_ui_auth', $cookie)
            ->get('/apps/demo-editor');

        $response->assertDontSee('PLUGIN_HTML_PROBE_9f3a', false);
        $response->assertDontSee('__WGW_PLUGIN_CONFIG__', false);
        $response->assertCookieMissing('sabre_ui_auth');
    }
}
