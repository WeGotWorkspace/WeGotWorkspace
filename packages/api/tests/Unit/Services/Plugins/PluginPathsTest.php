<?php

declare(strict_types=1);

namespace Tests\Unit\Services\Plugins;

use App\Services\Plugins\PluginPaths;
use App\Support\AppPaths;
use PHPUnit\Framework\Attributes\Test;
use Tests\Support\WithPluginsEnabled;
use Tests\TestCase;

final class PluginPathsTest extends TestCase
{
    use WithPluginsEnabled;

    private string $installRoot;

    protected function setUp(): void
    {
        parent::setUp();

        $this->installRoot = sys_get_temp_dir().'/wgw-plugin-paths-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);

        putenv('WGW_APP_ROOT='.$this->installRoot);
        $_ENV['WGW_APP_ROOT'] = $this->installRoot;
    }

    protected function tearDown(): void
    {
        putenv('WGW_APP_ROOT');
        unset($_ENV['WGW_APP_ROOT']);

        if (is_dir($this->installRoot)) {
            $this->removeTree($this->installRoot);
        }

        parent::tearDown();
    }

    #[Test]
    public function installed_index_path_uses_assets_directory(): void
    {
        $manifest = $this->installRoot.'/wgw-plugins/demo/plugin.json';
        $index = $this->installRoot.'/wgw-plugins/demo/assets/index.html';
        mkdir(dirname($manifest), 0777, true);
        mkdir(dirname($index), 0777, true);
        file_put_contents($manifest, '{}');
        file_put_contents($index, '<!doctype html>');

        $paths = new PluginPaths(app(AppPaths::class));

        $this->assertSame($index, $paths->indexPathForManifest($manifest));
    }

    private function removeTree(string $dir): void
    {
        $items = scandir($dir);
        if ($items === false) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            if (is_dir($path)) {
                $this->removeTree($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}
