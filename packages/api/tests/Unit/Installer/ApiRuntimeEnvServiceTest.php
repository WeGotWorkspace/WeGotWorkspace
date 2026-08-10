<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\ApiRuntimeEnvService;
use PHPUnit\Framework\TestCase;

final class ApiRuntimeEnvServiceTest extends TestCase
{
    private string $installRoot = '';

    private string $apiRoot = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->installRoot = sys_get_temp_dir().'/wgw-install-'.uniqid('', true);
        $this->apiRoot = $this->installRoot.'/packages/api';
        mkdir($this->apiRoot.'/vendor', 0775, true);
        touch($this->apiRoot.'/vendor/autoload.php');
    }

    protected function tearDown(): void
    {
        if ($this->installRoot !== '' && is_dir($this->installRoot)) {
            $this->rmTree($this->installRoot);
        }

        parent::tearDown();
    }

    public function test_ensure_creates_env_key_and_storage(): void
    {
        file_put_contents($this->apiRoot.'/.env.example', implode("\n", [
            'APP_KEY=',
            'APP_URL=http://localhost',
            'SESSION_DRIVER=file',
            '',
        ]));

        $service = new ApiRuntimeEnvService;
        $result = $service->ensure($this->installRoot, 'https://cloud.example.test');

        $this->assertTrue($result['createdEnv']);
        $this->assertTrue($result['generatedKey']);
        $this->assertTrue($result['patchedUrl']);
        $this->assertFileExists($this->apiRoot.'/.env');
        $this->assertDirectoryExists($this->apiRoot.'/storage/logs');

        $env = (string) file_get_contents($this->apiRoot.'/.env');
        $this->assertMatchesRegularExpression('/^APP_KEY=base64:/m', $env);
        $this->assertStringContainsString('APP_URL=https://cloud.example.test', $env);
    }

    public function test_ensure_at_api_root_supports_resolved_monorepo_api_path(): void
    {
        file_put_contents($this->apiRoot.'/.env.example', implode("\n", [
            'APP_KEY=',
            'APP_URL=http://localhost',
            '',
        ]));

        $service = new ApiRuntimeEnvService;
        $result = $service->ensureAtApiRoot($this->apiRoot, 'http://127.0.0.1:9080');

        $this->assertTrue($result['createdEnv']);
        $this->assertTrue($result['generatedKey']);
        $this->assertTrue($result['patchedUrl']);
    }

    public function test_api_package_root_falls_back_to_runtime_when_install_shell_has_no_api(): void
    {
        $shellOnly = sys_get_temp_dir().'/wgw-shell-'.uniqid('', true);
        mkdir($shellOnly, 0775, true);
        file_put_contents($shellOnly.'/index.php', "<?php\n");

        try {
            $service = new ApiRuntimeEnvService;
            $resolved = $service->apiPackageRoot($shellOnly);
            $expected = dirname(__DIR__, 3);

            $this->assertNotNull($resolved);
            $this->assertSame(realpath($expected), realpath((string) $resolved));
            $this->assertFileExists($resolved.'/vendor/autoload.php');
        } finally {
            @unlink($shellOnly.'/index.php');
            @rmdir($shellOnly);
        }
    }

    public function test_ensure_does_not_replace_existing_app_key(): void
    {
        file_put_contents($this->apiRoot.'/.env', "APP_KEY=base64:YWJj\nAPP_URL=https://existing.test\n");

        $service = new ApiRuntimeEnvService;
        $result = $service->ensure($this->installRoot, 'https://other.test');

        $this->assertFalse($result['createdEnv']);
        $this->assertFalse($result['generatedKey']);
        $this->assertFalse($result['patchedUrl']);
        $this->assertSame("APP_KEY=base64:YWJj\nAPP_URL=https://existing.test\n", file_get_contents($this->apiRoot.'/.env'));
    }

    private function rmTree(string $dir): void
    {
        $items = scandir($dir);
        if (! is_array($items)) {
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
