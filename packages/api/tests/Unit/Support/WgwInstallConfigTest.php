<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\WgwInstallConfig;
use PHPUnit\Framework\TestCase;

final class WgwInstallConfigTest extends TestCase
{
    private string $repoRoot = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->repoRoot = sys_get_temp_dir().'/wgw-install-config-'.uniqid('', true);
        mkdir($this->repoRoot.'/apps/wegotworkspace', 0775, true);
        mkdir($this->repoRoot.'/packages/api', 0775, true);
        file_put_contents($this->repoRoot.'/apps/wegotworkspace/index.php', "<?php\n");
        file_put_contents($this->repoRoot.'/packages/api/.env', "APP_KEY=base64:YWJj\n");
    }

    protected function tearDown(): void
    {
        if ($this->repoRoot !== '' && is_dir($this->repoRoot)) {
            $this->rmTree($this->repoRoot);
        }

        parent::tearDown();
    }

    public function test_looks_like_install_root_ignores_monorepo_git_root(): void
    {
        $config = new WgwInstallConfig;
        $method = new \ReflectionMethod(WgwInstallConfig::class, 'looksLikeInstallRoot');
        $method->setAccessible(true);

        $this->assertTrue($method->invoke($config, $this->repoRoot.'/apps/wegotworkspace'));
        $this->assertFalse($method->invoke($config, $this->repoRoot));
    }

    public function test_looks_like_install_root_accepts_release_tree_with_api_env(): void
    {
        $release = $this->repoRoot.'/release';
        mkdir($release.'/packages/api', 0775, true);
        file_put_contents($release.'/packages/api/.env', "APP_KEY=base64:YWJj\n");

        $config = new WgwInstallConfig;
        $method = new \ReflectionMethod(WgwInstallConfig::class, 'looksLikeInstallRoot');
        $method->setAccessible(true);

        $this->assertTrue($method->invoke($config, $release));
    }

    private function rmTree(string $dir): void
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
                $this->rmTree($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}
