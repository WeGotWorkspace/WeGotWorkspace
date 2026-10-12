<?php

declare(strict_types=1);

namespace Tests\Feature\Security;

use App\Support\WebRootDeny;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Tests\Support\UiDistFixture;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WithPluginsEnabled;
use Tests\TestCase;

final class WebRootKernelServeTest extends TestCase
{
    use WithPluginsEnabled;

    private ?string $repoRoot = null;

    protected function tearDown(): void
    {
        if ($this->repoRoot !== null) {
            UiDistFixture::removeTree($this->repoRoot);
            $this->repoRoot = null;
        }

        parent::tearDown();
    }

    public function test_shell_dist_asset_and_plugin_ui_stay_served_through_the_kernel(): void
    {
        $this->repoRoot = UiDistFixture::bootstrapMonorepoLayout();
        $installRoot = $this->repoRoot.'/apps/wegotworkspace';
        $dataDir = $installRoot.'/wgw-content';
        $pluginAssets = $installRoot.'/wgw-plugins/demo-plugin/assets';
        mkdir($pluginAssets, 0775, true);
        file_put_contents($pluginAssets.'/index.html', "<!doctype html><title>Plugin</title>\n");
        file_put_contents($pluginAssets.'/plugin-ui.js', "window.pluginUiAsset = true;\n");
        file_put_contents($installRoot.'/wgw-plugins/demo-plugin/plugin.json', json_encode([
            'id' => 'demo-plugin',
            'name' => 'Demo plugin',
            'active' => true,
            'appTile' => [
                'id' => 'demo',
                'label' => 'Demo',
                'route' => '/apps/demo-ui',
            ],
        ], JSON_THROW_ON_ERROR));

        WgwInstallFixture::markInstalled($installRoot, $dataDir);
        WebRootDeny::ensureAll($installRoot, $dataDir);
        WgwInstallFixture::syncDatabaseConnection();

        $distAsset = $this->repoRoot.'/packages/apps/shell/dist/assets/index-DBoOAm4k.css';
        $this->assertFileExists($distAsset);
        $this->assertFileExists($dataDir.'/.htaccess');
        $this->assertFileExists($installRoot.'/packages/.htaccess');
        $this->assertFileExists($installRoot.'/wgw-plugins/.htaccess');

        $this->assertKernelFile($this->get('/'), 'text/html; charset=utf-8', 'shell-fixture');
        $this->assertKernelFile(
            $this->get('/assets/index-DBoOAm4k.css'),
            'text/css; charset=utf-8',
            'PHPUnit fixture',
        );
        $this->assertKernelFile(
            $this->get('/apps/demo-ui/plugin-ui.js'),
            'application/javascript; charset=utf-8',
            'pluginUiAsset',
        );
    }

    private function assertKernelFile(TestResponse $response, string $contentType, string $needle): void
    {
        $response->assertOk()->assertHeader('Content-Type', $contentType);
        $served = $response->baseResponse;
        $this->assertInstanceOf(BinaryFileResponse::class, $served);
        $this->assertStringContainsString($needle, (string) file_get_contents($served->getFile()->getPathname()));
    }
}
