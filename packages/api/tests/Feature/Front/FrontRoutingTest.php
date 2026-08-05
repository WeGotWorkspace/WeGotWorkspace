<?php

declare(strict_types=1);

namespace Tests\Feature\Front;

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

    public function test_docs_app_path_serves_shell_not_webdav(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $docs = $this->get('/docs');
        $docs->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
        $this->assertStringNotContainsString('Sabre\\DAV\\Exception\\NotFound', (string) $docs->getContent());

        $this->get('/docs/')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
    }

    public function test_tasks_app_path_serves_shell_not_webdav(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $tasks = $this->get('/tasks/lists/inbox');
        $tasks->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
        $this->assertStringNotContainsString('Sabre\\DAV\\Exception\\NotFound', (string) $tasks->getContent());

        $this->get('/tasks')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
    }

    public function test_share_public_path_serves_shell_not_webdav(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $data = $installRoot.'/wgw-content';
        WgwInstallFixture::markInstalled($installRoot, $data);
        WgwInstallFixture::syncDatabaseConnection();

        $share = $this->get('/share/a4ce06285e2e44adb3c55ef3beddf65e');
        $share->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
        $this->assertStringNotContainsString('Sabre\\DAV\\Exception\\NotFound', (string) $share->getContent());
        $this->assertStringNotContainsString('File not found: share', (string) $share->getContent());

        $this->get('/share/')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/html; charset=utf-8');
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

    public function test_api_docs_login_persists_authorization_to_local_storage(): void
    {
        $content = (string) $this->get('/api/docs')->assertOk()->getContent();

        $this->assertStringContainsString('persistAuthorization: true', $content);
        $this->assertStringContainsString('preauthorizeApiKey("bearerAuth"', $content);
        $this->assertStringContainsString('authActions.persistAuthorizationIfNeeded()', $content);
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
}
