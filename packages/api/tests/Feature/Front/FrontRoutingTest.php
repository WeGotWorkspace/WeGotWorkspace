<?php

declare(strict_types=1);

namespace Tests\Feature\Front;

use App\Support\SecurityHeaderPolicy;
use App\Support\WebRootDeny;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\UiDistFixture;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class FrontRoutingTest extends TestCase
{
    private ?string $repoRoot = null;

    protected function tearDown(): void
    {
        if ($this->repoRoot !== null) {
            UiDistFixture::removeTree($this->repoRoot);
            $this->repoRoot = null;
        }

        parent::tearDown();
    }

    public function test_install_without_trailing_slash_serves_wizard(): void
    {
        $data = sys_get_temp_dir().'/wgw-front-'.uniqid('', true);
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout($data);

        $this->get('/install')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
    }

    public function test_uninstalled_root_redirects_to_install(): void
    {
        $data = sys_get_temp_dir().'/wgw-front-'.uniqid('', true);
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout($data);

        $this->get('/')
            ->assertRedirect('/install/');
    }

    public function test_installed_root_serves_shell_not_install_redirect(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $this->get('/')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
    }

    public function test_installed_install_path_redirects_to_login(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $this->get('/install/')
            ->assertRedirect('/login');
    }

    public function test_uninstalled_webdav_returns_503_from_laravel_route(): void
    {
        $data = sys_get_temp_dir().'/wgw-front-'.uniqid('', true);
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout($data);

        $this->call('PROPFIND', '/', [], [], [], ['HTTP_ACCEPT' => '*/*'])
            ->assertStatus(503)
            ->assertHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    public function test_api_health_still_served_by_api_routes(): void
    {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertJsonPath('status', 'ok');
    }

    /**
     * Checklist: every non-root shell SPA prefix must serve HTML, not SabreDAV.
     * Keep paths aligned with UiStaticServer::shellRoutePrefixes() and the apps router
     * (SpaShellRouteAllowlistTest). Precedents: /tasks, /share.
     *
     * @return array<string, array{0: string}>
     */
    public static function shellSpaPathProvider(): array
    {
        return [
            'admin' => ['/admin'],
            'calendar' => ['/calendar'],
            'calendar rsvp' => ['/calendar/rsvp/demo-token'],
            'contacts' => ['/contacts'],
            'docs' => ['/docs'],
            'drive' => ['/drive'],
            'login' => ['/login'],
            'logout' => ['/logout'],
            'meet' => ['/meet'],
            'notes' => ['/notes'],
            'settings' => ['/settings'],
            'settings nested' => ['/settings/assistants'],
            'share' => ['/share/a4ce06285e2e44adb3c55ef3beddf65e'],
            'share trailing slash' => ['/share/'],
            'tasks' => ['/tasks'],
            'tasks nested' => ['/tasks/lists/inbox'],
        ];
    }

    #[DataProvider('shellSpaPathProvider')]
    public function test_shell_spa_path_serves_html_not_webdav(string $path): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $response = $this->get($path);
        $response->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
        $this->assertStringNotContainsString('Sabre\\DAV\\Exception\\NotFound', (string) $response->getContent());
        $this->assertStringNotContainsString('File not found:', (string) $response->getContent());
    }

    /**
     * 302, not 301. Mail returns in v1.0; a permanent redirect would stick in browsers.
     */
    public function test_installed_mail_paths_redirect_home_temporarily(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        foreach (['/mail', '/mail/', '/mail/inbox'] as $path) {
            $response = $this->get($path);
            $response->assertStatus(302);
            $response->assertHeader('Location', url('/'));
            $this->assertStringNotContainsString('Sabre\\DAV', (string) $response->getContent());
        }
    }

    /**
     * 302, not 301. Plugins return after the beta; a permanent redirect would stick in browsers.
     */
    public function test_installed_plugin_app_paths_redirect_home_temporarily(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        foreach (['/apps', '/apps/', '/apps/office'] as $path) {
            $response = $this->get($path);
            $response->assertStatus(302);
            $response->assertHeader('Location', url('/'));
            $this->assertStringNotContainsString('Sabre\\DAV', (string) $response->getContent());
        }
    }

    public function test_api_docs_not_handled_by_webdav_catch_all(): void
    {
        $this->get('/api/docs')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');

        $this->get('/api/docs/')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
    }

    public function test_api_docs_does_not_persist_authorization(): void
    {
        $response = $this->get('/api/docs')->assertOk();
        $content = (string) $response->getContent();

        $this->assertMatchesRegularExpression('/src="[^"]*\/swagger-init\.js"/', $content);
        $this->assertDoesNotMatchRegularExpression('/<script(?![^>]*\bsrc=)[^>]*>/i', $content);
        $this->assertSame(
            SecurityHeaderPolicy::policy(),
            $response->headers->get('Content-Security-Policy'),
        );
        $this->assertStringNotContainsString(
            'nonce-',
            (string) $response->headers->get('Content-Security-Policy'),
        );

        $script = (string) $this->get('/api/docs/swagger-init.js')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/javascript; charset=utf-8')
            ->getContent();

        $this->assertStringContainsString('persistAuthorization: false', $script);
        $this->assertStringContainsString('preauthorizeApiKey("bearerAuth"', $script);
        $this->assertStringNotContainsString('persistAuthorizationIfNeeded()', $script);
    }

    public function test_openapi_json_is_served(): void
    {
        $this->getJson('/api/openapi.json')
            ->assertOk()
            ->assertJsonPath('openapi', '3.1.0');
    }

    public function test_swagger_css_has_stylesheet_mime_type(): void
    {
        $this->get('/api/docs/swagger-ui.css')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/css; charset=utf-8');
    }

    public function test_app_icon_svg_path_serves_shell_asset(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $this->get('/app-icons/settings.svg')
            ->assertOk()
            ->assertHeader('Content-Type', 'image/svg+xml');
    }

    public function test_apple_touch_icon_path_serves_shell_asset(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $this->get('/pwa-icons/settings-180.png')
            ->assertOk()
            ->assertHeader('Content-Type', 'image/png');

        $versionFile = dirname(__DIR__, 5).'/packages/apps/src/lib/pwa-icon-cache-version.json';
        $version = json_decode((string) file_get_contents($versionFile), true, 512, JSON_THROW_ON_ERROR);
        $this->assertIsArray($version);

        $this->get('/pwa-icons/settings-180.png?v='.$version['version'])
            ->assertOk()
            ->assertHeader('Content-Type', 'image/png');

        $this->get('/manifests/settings.webmanifest?v='.$version['version'])
            ->assertOk()
            ->assertHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }

    public function test_inbox_chime_path_serves_shell_asset(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $this->get('/sounds/notification-chime.mp3')
            ->assertOk()
            ->assertHeader('Content-Type', 'audio/mpeg');
    }

    public function test_index_html_path_serves_shell_asset(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $this->get('/index.html')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
    }

    public function test_csp_shell_sends_enforcing_policy(): void
    {
        $this->installedShell();
        $policy = $this->shellPolicy();

        $this->assertSame(SecurityHeaderPolicy::policy(), $policy);
        $this->assertStringContainsString("script-src 'self' 'wasm-unsafe-eval'", $policy);
        $this->assertStringNotContainsString('nonce-', $policy);
        $this->assertStringNotContainsString('sha256-', $policy);
        $this->assertStringContainsString("default-src 'self'", $policy);
        $this->assertStringContainsString("style-src 'self' 'unsafe-inline'", $policy);
        $this->assertStringContainsString("img-src 'self' blob: data:", $policy);
        $this->assertStringNotContainsString('https:', $policy);
        $this->assertStringContainsString("font-src 'self'", $policy);
        $this->assertStringContainsString("connect-src 'self'", $policy);
        $this->assertStringContainsString("media-src 'self' blob:", $policy);
        $this->assertStringContainsString("worker-src 'self'", $policy);
        $this->assertStringContainsString("manifest-src 'self'", $policy);
        $this->assertStringContainsString("object-src 'none'", $policy);
        $this->assertStringContainsString("base-uri 'self'", $policy);
        $this->assertStringContainsString("form-action 'self'", $policy);
        $this->assertStringContainsString("frame-ancestors 'self'", $policy);
        $this->assertStringContainsString('report-uri /api/v1/csp-reports', $policy);
    }

    public function test_csp_hsts_only_on_https(): void
    {
        $this->installedShell();

        $https = $this->call('GET', 'https://localhost/', [], [], [], [
            'HTTP_ACCEPT' => 'text/html',
        ]);
        $https->assertOk();
        $https->assertHeader('Strict-Transport-Security', SecurityHeaderPolicy::HSTS);
        $hsts = (string) $https->headers->get('Strict-Transport-Security');
        $this->assertStringNotContainsString('includeSubDomains', $hsts);
        $this->assertStringNotContainsString('preload', $hsts);

        $this->call('GET', 'http://localhost/', [], [], [], ['HTTP_ACCEPT' => 'text/html'])
            ->assertOk()
            ->assertHeaderMissing('Strict-Transport-Security');

        $this->call('GET', 'http://localhost/', [], [], [], [
            'HTTP_ACCEPT' => 'text/html',
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTP_X_FORWARDED_PROTO' => 'https',
        ])->assertOk()->assertHeaderMissing('Strict-Transport-Security');
    }

    public function test_csp_report_accepts_and_rejects_oversize_bypass(): void
    {
        $reports = [];
        $this->listenForCspReports($reports);

        $this->postCspReport('{"csp-report":{"violated-directive":"script-src"}}')
            ->assertNoContent();
        $this->postCspReport(str_repeat('a', 8192))->assertNoContent();
        $this->assertCount(2, $reports);
        $this->assertSame('info', $reports[0]->level);
        $this->assertSame('daily', config('logging.channels.csp.driver'));
        $this->assertSame(7, (int) config('logging.channels.csp.days'));
        $this->assertSame('script-src', $reports[0]->context['violated-directive'] ?? null);

        $beforeRejects = count($reports);
        $this->postCspReport(str_repeat('b', 8193))->assertStatus(413);
        $this->postCspReport(str_repeat('c', 8193), ['CONTENT_LENGTH' => '4'])->assertStatus(413);
        $this->postCspReport('{}', ['CONTENT_LENGTH' => '9000'])->assertStatus(413);
        $this->postCspReport('{"ok":true}', ['CONTENT_LENGTH' => '08192'])->assertNoContent();
        $this->postCspReport('{"ok":true}', ['CONTENT_LENGTH' => '08193'])->assertStatus(413);
        $this->assertCount($beforeRejects + 1, $reports);
    }

    public function test_csp_report_limit_ignores_spoofed_forwarded_for(): void
    {
        $server = ['REMOTE_ADDR' => '203.0.113.44'];
        for ($attempt = 0; $attempt < 60; $attempt++) {
            $this->postCspReport('{}', $server)->assertNoContent();
        }

        $this->postCspReport('{}', $server)->assertStatus(429);
        $this->postCspReport('{}', array_replace($server, [
            'HTTP_X_FORWARDED_FOR' => '198.51.100.8',
            'HTTP_ORIGIN' => 'https://attacker.example',
        ]))->assertStatus(429);
    }

    public function test_csp_api_json_gets_nosniff_and_conditional_hsts(): void
    {
        $this->getJson('http://localhost/api/v1/health')
            ->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeaderMissing('Strict-Transport-Security')
            ->assertHeaderMissing('Content-Security-Policy')
            ->assertHeaderMissing('Content-Security-Policy-Report-Only');

        $https = $this->call('GET', 'https://localhost/api/v1/health', [], [], [], [
            'HTTP_ACCEPT' => 'application/json',
        ]);
        $https->assertOk();
        $https->assertHeader('X-Content-Type-Options', 'nosniff');
        $https->assertHeader('Strict-Transport-Security', SecurityHeaderPolicy::HSTS);
        $https->assertHeaderMissing('Content-Security-Policy');
        $https->assertHeaderMissing('Content-Security-Policy-Report-Only');
    }

    public function test_csp_htaccess_sets_enforcing_header(): void
    {
        $root = dirname(__DIR__, 5).'/apps/wegotworkspace';
        foreach (['.htaccess', 'example.htaccess'] as $name) {
            $htaccess = (string) file_get_contents($root.'/'.$name);
            $this->assertMatchesRegularExpression(
                '/Header always set Strict-Transport-Security "'.preg_quote(SecurityHeaderPolicy::HSTS, '/').'" env=HTTPS/',
                $htaccess,
                $name,
            );
            $this->assertMatchesRegularExpression(
                '/SetEnvIf X-Forwarded-Proto "\^https\$" WGW_HTTPS=on/',
                $htaccess,
                $name,
            );
            $this->assertMatchesRegularExpression(
                '/Header always set Strict-Transport-Security "'.preg_quote(SecurityHeaderPolicy::HSTS, '/').'" env=WGW_HTTPS/',
                $htaccess,
                $name,
            );
            $this->assertDoesNotMatchRegularExpression(
                '/SetEnvIf\s+X-Forwarded-Proto\b[^\n]*\bHTTPS=/',
                $htaccess,
                $name,
            );
            $this->assertStringContainsString(WebRootDeny::managedHeadersBlock(), $htaccess, $name);
            $this->assertStringNotContainsString('Content-Security-Policy-Report-Only', $htaccess, $name);
            $this->assertStringNotContainsString('https:', $htaccess, $name);
        }
    }

    private function installedShell(): void
    {
        if ($this->repoRoot !== null) {
            return;
        }

        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();
    }

    /**
     * @param  array<string, string>  $server
     */
    private function shellPolicy(array $server = []): string
    {
        $response = $this->call('GET', '/', [], [], [], array_replace([
            'HTTP_ACCEPT' => 'text/html',
        ], $server));
        $response->assertOk();
        $response->assertHeaderMissing('Content-Security-Policy-Report-Only');
        $policy = $response->headers->get('Content-Security-Policy');
        $this->assertIsString($policy, 'SPA shell is missing Content-Security-Policy');

        return $policy;
    }

    /**
     * @param  array<string, string>  $server
     */
    private function postCspReport(string $body, array $server = []): TestResponse
    {
        return $this->call('POST', '/api/v1/csp-reports', [], [], [], array_replace([
            'CONTENT_TYPE' => 'application/csp-report',
            'HTTP_ACCEPT' => 'application/json',
            'REMOTE_ADDR' => '203.0.113.50',
        ], $server), $body);
    }

    /**
     * @param  list<MessageLogged>  $reports
     */
    private function listenForCspReports(array &$reports): void
    {
        Log::listen(function (MessageLogged $event) use (&$reports): void {
            if ($event->message === 'csp.report') {
                $reports[] = $event;
            }
        });
    }
}
