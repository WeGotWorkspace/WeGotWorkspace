<?php

declare(strict_types=1);

namespace Tests\Feature\Plugins;

use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwRoleFixtures;

final class PluginsEndpointsTest extends WgwDatabaseTestCase
{
    use WgwRoleFixtures;

    private string $dataDir = '';

    protected function setUp(): void
    {
        $this->dataDir = rtrim(sys_get_temp_dir(), '/').'/wgw-plugins-'.uniqid('', true);
        @mkdir($this->dataDir.'/install-root/wgw-plugins/demo-plugin/assets', 0777, true);
        @file_put_contents($this->dataDir.'/install-root/wgw-plugins/demo-plugin/assets/index.html', '<!doctype html><title>Plugin</title>');
        @file_put_contents($this->dataDir.'/install-root/wgw-plugins/demo-plugin/assets/editor.html', '<!doctype html><title>Editor</title>');
        @file_put_contents($this->dataDir.'/install-root/wgw-plugins/demo-plugin/plugin.json', json_encode([
            'id' => 'demo-plugin',
            'name' => 'Demo plugin',
            'active' => true,
            'appTile' => [
                'id' => 'demo',
                'label' => 'Demo',
                'route' => '/apps/demo-editor',
            ],
            'drive' => [
                'openFileExtensions' => ['docx'],
            ],
        ], JSON_THROW_ON_ERROR));
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        parent::setUp();
        WgwInstallFixture::bindInstallRoot($this->dataDir.'/install-root');
        $this->configureRoleMatrix();
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    public function test_plugins_requires_auth_and_returns_drive_handlers(): void
    {
        $this->getJson('/api/v1/plugins')->assertUnauthorized();

        $token = $this->issueBearerToken();

        $response = $this->withBearer($token)->getJson('/api/v1/plugins');

        $response->assertOk()
            ->assertJsonStructure([
                'plugins' => [[
                    'id',
                    'name',
                    'active',
                    'source',
                    'runtime' => [
                        'indexReady',
                        'editorReady',
                    ],
                ]],
            ]);
    }

    public function test_plugins_runtime_readiness_flags(): void
    {
        $this->withBearer($this->issueBearerToken())->getJson('/api/v1/plugins')
            ->assertOk()
            ->assertJsonPath('plugins.0.runtime.indexReady', true)
            ->assertJsonPath('plugins.0.runtime.editorReady', true);
    }

    public function test_plugins_can_be_activated_and_deactivated(): void
    {
        $client = $this->withBearer($this->adminBearerToken());

        $client->putJson('/api/v1/admin/plugins/demo-plugin/activation', ['active' => false])
            ->assertOk()
            ->assertJsonPath('plugin.id', 'demo-plugin')
            ->assertJsonPath('plugin.active', false);

        $client->getJson('/api/v1/plugins')
            ->assertOk()
            ->assertJsonFragment([
                'id' => 'demo-plugin',
                'active' => false,
            ]);

        $client->putJson('/api/v1/admin/plugins/demo-plugin/activation', ['active' => true])
            ->assertOk()
            ->assertJsonPath('plugin.id', 'demo-plugin')
            ->assertJsonPath('plugin.active', true);

        $client->putJson('/api/v1/admin/plugins/unknown/activation', ['active' => false])
            ->assertNotFound()
            ->assertJsonPath('error', 'plugin_not_found');
    }

    public function test_regular_user_cannot_change_plugin_activation(): void
    {
        $this->withBearer($this->userBearerToken())
            ->putJson('/api/v1/admin/plugins/demo-plugin/activation', ['active' => false])
            ->assertForbidden();

        $this->withBearer($this->userBearerToken())
            ->putJson('/api/v1/plugins/demo-plugin/activation', ['active' => false])
            ->assertNotFound();
    }
}
