<?php

declare(strict_types=1);

namespace Tests\Feature\Security;

use App\Support\WebRootDeny;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Tests\Support\UiDistFixture;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class WebRootKernelServeTest extends TestCase
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

    /**
     * An upgraded install can still hold a wgw-plugins/ tree. The deny file is written
     * into it, and its old app route redirects home instead of serving the plugin asset.
     */
    public function test_shell_dist_asset_is_served_and_a_leftover_plugin_tree_is_not(): void
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

        $plugin = $this->get('/apps/demo-ui/plugin-ui.js');
        $plugin->assertStatus(302)->assertHeader('Location', url('/'));
        $plugin->assertDontSee('pluginUiAsset', false);

        $direct = $this->get('/wgw-plugins/demo-plugin/assets/plugin-ui.js');
        $direct->assertNotFound();
        $direct->assertDontSee('pluginUiAsset', false);
    }

    private function assertKernelFile(TestResponse $response, string $contentType, string $needle): void
    {
        $response->assertOk()->assertHeader('Content-Type', $contentType);
        $served = $response->baseResponse;
        $this->assertInstanceOf(BinaryFileResponse::class, $served);
        $this->assertStringContainsString($needle, (string) file_get_contents($served->getFile()->getPathname()));
    }
}
