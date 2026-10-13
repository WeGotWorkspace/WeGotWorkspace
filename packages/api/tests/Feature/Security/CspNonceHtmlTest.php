<?php

declare(strict_types=1);

namespace Tests\Feature\Security;

use App\Models\Principal;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Auth\UiSessionService;
use App\Support\SecurityHeaderPolicy;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;
use Tests\Support\WithPluginsEnabled;

final class CspNonceHtmlTest extends WgwDatabaseTestCase
{
    use WithPluginsEnabled;

    private string $installRoot = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $_SERVER['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);

        $this->installRoot = sys_get_temp_dir().'/wgw-csp-nonce-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);
        file_put_contents($this->installRoot.'/index.php', "<?php\n");
        $dataDir = $this->installRoot.'/wgw-content';
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

        WgwInstallFixture::bindInstallRoot($this->installRoot, $dataDir);
        WgwInstallFixture::markInstalled($this->installRoot, $dataDir, 'alice');
        config(['wgw.install_root' => $this->installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->setAppSetting(WgwSettings::FILES_ENABLED, true);

        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $adminGroup = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($adminGroup, $alice);

        WgwTestDisks::refresh($dataDir);
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

    public function test_plugin_page_nonce_matches_enforcing_script_src(): void
    {
        $realm = (string) (WgwSettings::normalized()[WgwSettings::AUTH_REALM] ?? 'SabreDAV');
        $cookie = $this->app->make(UiSessionService::class)->buildCookie('alice', $realm, '/');
        $_COOKIE['sabre_ui_auth'] = $cookie->getValue();
        try {
            $response = $this->withUnencryptedCookie('sabre_ui_auth', $cookie->getValue())
                ->get('/apps/demo-editor/');
            $response->assertOk();

            $html = (string) $response->getContent();
            $policy = (string) $response->headers->get('Content-Security-Policy');

            $this->assertSame(1, preg_match('/<script nonce="([^"]+)">window\./', $html, $m));
            $nonce = $m[1];
            $this->assertStringContainsString("script-src 'self' 'wasm-unsafe-eval' 'nonce-".$nonce."'", $policy);
            $response->assertHeaderMissing('Content-Security-Policy-Report-Only');
            $response->assertHeader('Cache-Control', 'must-revalidate, no-cache, no-store, private');
        } finally {
            unset($_COOKIE['sabre_ui_auth']);
        }
    }

    public function test_plugin_login_redirect_stays_nonce_free(): void
    {
        // A missing index.html never reaches PluginHtmlResponder: the registry
        // skips that plugin and Sabre answers 404 XML with no CSP header.
        unset($_COOKIE['sabre_ui_auth']);

        $response = $this->get('/apps/demo-editor/');

        $response->assertRedirect();
        $this->assertStringContainsString('/login?return=', (string) $response->headers->get('Location'));
        $policy = (string) $response->headers->get('Content-Security-Policy');
        $this->assertSame(SecurityHeaderPolicy::policy(), $policy);
        $this->assertStringNotContainsString('nonce-', $policy);
    }
}
