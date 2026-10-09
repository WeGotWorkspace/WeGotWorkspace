<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Support\AppPaths;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WithPluginsEnabled;

final class AdminPluginsTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;
    use WithPluginsEnabled;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures(withAppRoot: true);
        $this->seedDemoPlugin();
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_admin_can_list_and_toggle_plugin_activation(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->getJson('/api/v1/plugins')
            ->assertOk()
            ->assertJsonFragment([
                'id' => 'demo-plugin',
                'active' => true,
            ]);

        $this->withBearer($token)
            ->putJson('/api/v1/admin/plugins/demo-plugin/activation', ['active' => false])
            ->assertOk()
            ->assertJsonPath('plugin.active', false);

        $this->withBearer($token)
            ->getJson('/api/v1/plugins')
            ->assertOk()
            ->assertJsonFragment([
                'id' => 'demo-plugin',
                'active' => false,
            ]);

        $this->withBearer($token)
            ->putJson('/api/v1/admin/plugins/demo-plugin/activation', ['active' => true])
            ->assertOk();
    }

    public function test_non_admin_cannot_install_plugin_zip(): void
    {
        $this->withBearer($this->userBearerToken())
            ->post('/api/v1/admin/plugins', [])
            ->assertForbidden();
    }

    public function test_admin_can_install_plugin_zip(): void
    {
        $zipPath = $this->adminDataDirectory().'/demo-plugin.zip';
        $sourceRoot = $this->adminDataDirectory().'/plugin-source/demo-plugin';
        File::ensureDirectoryExists($sourceRoot.'/assets');
        File::put($sourceRoot.'/assets/index.html', '<!doctype html><title>Plugin</title>');
        File::put($sourceRoot.'/plugin.json', json_encode([
            'id' => 'demo-plugin',
            'name' => 'Demo plugin',
            'active' => true,
            'drive' => [
                'openFileExtensions' => ['docx'],
            ],
        ], JSON_THROW_ON_ERROR));

        $zip = new \ZipArchive;
        $opened = $zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);
        $this->assertSame(true, $opened);
        $zip->addFile($sourceRoot.'/plugin.json', 'demo-plugin/plugin.json');
        $zip->addFile($sourceRoot.'/assets/index.html', 'demo-plugin/assets/index.html');
        $zip->close();

        $upload = new UploadedFile($zipPath, 'demo-plugin.zip', 'application/zip', null, true);

        $this->withBearer($this->adminBearerToken())
            ->post('/api/v1/admin/plugins', ['plugin' => $upload])
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('plugin.id', 'demo-plugin')
            ->assertJsonPath('plugin.active', true);

        $pluginsRoot = app(AppPaths::class)->pluginsRoot();
        $this->assertFileExists($pluginsRoot.'/demo-plugin/plugin.json');
        $this->assertFileExists($pluginsRoot.'/demo-plugin/assets/index.html');
    }

    private function seedDemoPlugin(): void
    {
        $root = $this->adminDataDirectory().'/install-root/wgw-plugins/demo-plugin';
        File::ensureDirectoryExists($root.'/assets');
        File::put($root.'/assets/index.html', '<!doctype html><title>Plugin</title>');
        File::put($root.'/plugin.json', json_encode([
            'id' => 'demo-plugin',
            'name' => 'Demo plugin',
            'active' => true,
            'drive' => [
                'openFileExtensions' => ['docx'],
            ],
        ], JSON_THROW_ON_ERROR));
    }
}
