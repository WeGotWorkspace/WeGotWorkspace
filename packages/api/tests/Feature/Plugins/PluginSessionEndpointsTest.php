<?php

declare(strict_types=1);

namespace Tests\Feature\Plugins;

use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WithPluginsEnabled;

final class PluginSessionEndpointsTest extends WgwDatabaseTestCase
{
    use WithPluginsEnabled;

    private string $dataDir = '';

    protected function setUp(): void
    {
        $this->dataDir = rtrim(sys_get_temp_dir(), '/').'/wgw-plugin-session-'.uniqid('', true);
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
            'integration' => [
                'sessionApiPath' => '/api/v1/plugins/demo-plugin/session',
            ],
        ], JSON_THROW_ON_ERROR));
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        parent::setUp();
        WgwInstallFixture::bindInstallRoot($this->dataDir.'/install-root');
        $this->configureWgwJwtKeys();
        $this->seedAlice();
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    public function test_plugin_session_requires_auth_and_establishes_cookie(): void
    {
        $this->postJson('/api/v1/plugins/demo-plugin/session')->assertUnauthorized();

        $client = $this->withBearer($this->issueBearerToken());

        $client->postJson('/api/v1/plugins/unknown/session')
            ->assertNotFound()
            ->assertJsonPath('error', 'plugin_not_found');

        $client->postJson('/api/v1/plugins/demo-plugin/session')
            ->assertOk()
            ->assertJsonPath('ok', true);
    }

    private function seedAlice(): void
    {
        $this->seedWgwUser('alice', displayName: 'Alice');
    }
}
