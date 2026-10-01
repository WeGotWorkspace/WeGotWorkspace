<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\ApiRuntimeEnvService;
use App\Services\Installer\InstallerEnvWriter;
use App\Support\AppPaths;
use App\Support\WgwDatabaseProbe;
use App\Support\WgwInstallConfig;
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

    public function test_ensure_rewrites_symlink_target_without_dropping_keys(): void
    {
        $volume = sys_get_temp_dir().'/wgw-env-vol-'.uniqid('', true);
        mkdir($volume, 0775, true);
        $body = "APP_KEY=\nAPP_URL=http://localhost\nWGW_INSTALL_DB_DRIVER=mysql\nWGW_INSTALL_DB_HOST=db\n";
        file_put_contents($volume.'/api.env', $body);
        symlink($volume.'/api.env', $this->apiRoot.'/.env');

        try {
            $result = (new ApiRuntimeEnvService)->ensureAtApiRoot($this->apiRoot, 'http://127.0.0.1:18080');

            $this->assertTrue(is_link($this->apiRoot.'/.env'));
            $this->assertTrue($result['generatedKey']);
            $this->assertTrue($result['patchedUrl']);
            $written = (string) file_get_contents($volume.'/api.env');
            $this->assertMatchesRegularExpression('/^APP_KEY=base64:/m', $written);
            $this->assertStringContainsString('APP_URL=http://127.0.0.1:18080', $written);
            $this->assertStringContainsString('WGW_INSTALL_DB_DRIVER=mysql', $written);
            $this->assertStringContainsString('WGW_INSTALL_DB_HOST=db', $written);
            $this->assertSame(0600, $this->mode($volume.'/api.env'));
            $this->assertSame(0660, $this->mode($volume.'/api.env.lock'));
        } finally {
            @unlink($volume.'/api.env.lock');
            @unlink($volume.'/api.env');
            @rmdir($volume);
        }
    }

    public function test_concurrent_ensure_never_exposes_a_partial_env_file(): void
    {
        $lines = [
            'APP_NAME=Laravel',
            'APP_KEY=',
            'APP_URL=http://localhost',
            'WGW_INSTALL_DB_DRIVER=mysql',
            'WGW_INSTALL_DB_HOST=db',
            'WGW_INSTALL_CHANNEL=docker',
        ];
        // Large enough that the old open-truncate-write window is observable.
        // A fresh Docker install lost every key except APP_KEY and APP_URL.
        for ($n = 0; $n < 4000; $n++) {
            $lines[] = 'WGW_PAD_'.$n.'='.str_repeat('x', 40);
        }
        $body = implode("\n", $lines)."\n";
        file_put_contents($this->apiRoot.'/.env', $body);

        $worker = tempnam(sys_get_temp_dir(), 'wgw-env-worker-');
        $this->assertNotFalse($worker);
        file_put_contents($worker, <<<'PHP'
<?php
require $argv[1];
$service = new App\Services\Installer\ApiRuntimeEnvService;
for ($i = 0; $i < 25; $i++) {
    $service->ensureAtApiRoot($argv[2], 'http://127.0.0.1:18080');
}
PHP);

        $autoload = dirname(__DIR__, 3).'/vendor/autoload.php';
        $envPath = $this->apiRoot.'/.env';
        $sawEmpty = 0;
        $sawMissing = 0;
        $proc = proc_open(
            [PHP_BINARY, $worker, $autoload, $this->apiRoot],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        $this->assertIsResource($proc);
        fclose($pipes[1]);
        fclose($pipes[2]);

        try {
            $deadline = microtime(true) + 8;
            do {
                $status = proc_get_status($proc);
                clearstatcache(true, $envPath);
                $content = @file_get_contents($envPath);
                if (! is_string($content) || $content === '') {
                    $sawEmpty++;
                } elseif (! str_contains($content, 'WGW_INSTALL_DB_DRIVER=mysql') || ! str_contains($content, 'WGW_PAD_3999=')) {
                    $sawMissing++;
                }
                if (! $status['running']) {
                    break;
                }
            } while (microtime(true) < $deadline);
        } finally {
            $exit = proc_close($proc);
            @unlink($worker);
        }

        $this->assertSame(0, $exit);
        $this->assertSame(0, $sawEmpty);
        $this->assertSame(0, $sawMissing);

        $env = (string) file_get_contents($envPath);
        $this->assertMatchesRegularExpression('/^APP_KEY=base64:[A-Za-z0-9+\/=]+$/m', $env);
        $this->assertStringContainsString('WGW_INSTALL_DB_HOST=db', $env);
        $this->assertStringContainsString('WGW_INSTALL_CHANNEL=docker', $env);
        $this->assertStringContainsString('APP_URL=http://127.0.0.1:18080', $env);
        $this->assertGreaterThan(strlen($body), strlen($env));
    }

    public function test_ensure_follows_a_symlink_chain_to_the_real_file(): void
    {
        $volume = sys_get_temp_dir().'/wgw-env-chain-'.uniqid('', true);
        mkdir($volume, 0775, true);
        $body = "APP_KEY=\nAPP_URL=http://localhost\nWGW_INSTALL_DB_HOST=db\n";
        file_put_contents($volume.'/api.env', $body);
        symlink($volume.'/api.env', $volume.'/mid.env');
        symlink($volume.'/mid.env', $this->apiRoot.'/.env');

        try {
            $result = (new ApiRuntimeEnvService)->ensureAtApiRoot($this->apiRoot, 'http://127.0.0.1:18080');

            $this->assertTrue(is_link($this->apiRoot.'/.env'));
            $this->assertTrue(is_link($volume.'/mid.env'));
            $this->assertTrue($result['generatedKey']);
            $written = (string) file_get_contents($volume.'/api.env');
            $this->assertMatchesRegularExpression('/^APP_KEY=base64:/m', $written);
            $this->assertStringContainsString('WGW_INSTALL_DB_HOST=db', $written);
            $this->assertSame(0600, $this->mode($volume.'/api.env'));
        } finally {
            @unlink($volume.'/api.env.lock');
            @unlink($volume.'/mid.env');
            @unlink($volume.'/api.env');
            @rmdir($volume);
        }
    }

    public function test_installer_writer_follows_a_dangling_symlink(): void
    {
        $volume = sys_get_temp_dir().'/wgw-env-dangling-'.uniqid('', true);
        mkdir($volume, 0775, true);
        $target = $volume.'/api.env';
        symlink($target, $this->apiRoot.'/.env');

        try {
            $this->envWriter()->patchEnvFile($this->apiRoot.'/.env', [
                'WGW_DB_PASSWORD' => 'installer-secret',
            ]);

            $this->assertTrue(is_link($this->apiRoot.'/.env'));
            $written = (string) file_get_contents($target);
            $this->assertStringContainsString('WGW_DB_PASSWORD=installer-secret', $written);
            $this->assertSame(0600, $this->mode($target));
            $this->assertSame(0660, $this->mode($target.'.lock'));
        } finally {
            @unlink($target.'.lock');
            @unlink($target);
            @rmdir($volume);
        }
    }

    public function test_ensure_restricts_env_to_owner_read_write(): void
    {
        file_put_contents($this->apiRoot.'/.env', "APP_KEY=\nAPP_URL=http://localhost\n");
        chmod($this->apiRoot.'/.env', 0644);

        (new ApiRuntimeEnvService)->ensureAtApiRoot($this->apiRoot, 'http://127.0.0.1:18080');

        $this->assertSame(0600, $this->mode($this->apiRoot.'/.env'));
        $this->assertSame(0660, $this->mode($this->apiRoot.'/.env.lock'));
    }

    public function test_ensure_and_installer_writer_do_not_clobber_each_other(): void
    {
        $lines = [
            'APP_KEY=',
            'APP_URL=http://localhost',
            'WGW_DB_HOST=db',
        ];
        for ($n = 0; $n < 2000; $n++) {
            $lines[] = 'WGW_PAD_'.$n.'='.str_repeat('y', 40);
        }
        $envPath = $this->apiRoot.'/.env';
        file_put_contents($envPath, implode("\n", $lines)."\n");
        chmod($envPath, 0600);

        $worker = tempnam(sys_get_temp_dir(), 'wgw-env-writer-');
        $this->assertNotFalse($worker);
        file_put_contents($worker, <<<'PHP'
<?php
require $argv[1];
$service = new App\Services\Installer\ApiRuntimeEnvService;
for ($i = 0; $i < 20; $i++) {
    $service->ensureAtApiRoot($argv[2], 'http://127.0.0.1:18080');
}
PHP);

        $autoload = dirname(__DIR__, 3).'/vendor/autoload.php';
        $writer = $this->envWriter();
        $sawEmpty = 0;
        $sawMissing = 0;
        $proc = proc_open(
            [PHP_BINARY, $worker, $autoload, $this->apiRoot],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        $this->assertIsResource($proc);
        fclose($pipes[1]);
        fclose($pipes[2]);

        try {
            $deadline = microtime(true) + 8;
            do {
                $writer->patchEnvFile($envPath, [
                    'WGW_DB_PASSWORD' => 'installer-secret',
                    'WGW_DB_HOST' => 'db',
                ]);
                $status = proc_get_status($proc);
                clearstatcache(true, $envPath);
                $content = @file_get_contents($envPath);
                if (! is_string($content) || $content === '') {
                    $sawEmpty++;
                } elseif (
                    ! str_contains($content, 'WGW_DB_PASSWORD=installer-secret')
                    || ! str_contains($content, 'WGW_DB_HOST=db')
                    || ! str_contains($content, 'WGW_PAD_1999=')
                ) {
                    $sawMissing++;
                }
                if (! $status['running']) {
                    break;
                }
            } while (microtime(true) < $deadline);
        } finally {
            $exit = proc_close($proc);
            @unlink($worker);
        }

        $this->assertSame(0, $exit);
        $this->assertSame(0, $sawEmpty);
        $this->assertSame(0, $sawMissing);

        $env = (string) file_get_contents($envPath);
        $this->assertMatchesRegularExpression('/^APP_KEY=base64:[A-Za-z0-9+\/=]+$/m', $env);
        $this->assertStringContainsString('WGW_DB_PASSWORD=installer-secret', $env);
        $this->assertStringContainsString('WGW_DB_HOST=db', $env);
        $this->assertStringContainsString('WGW_PAD_1999=', $env);
        $this->assertSame(0600, $this->mode($envPath));
    }

    public function test_ensure_strips_invalid_dotenv_lines(): void
    {
        file_put_contents($this->apiRoot.'/.env', "APP_KEY=base64:YWJj\nAPP_URL=https://existing.test\nreply@example.com\n");

        $service = new ApiRuntimeEnvService;
        $result = $service->ensure($this->installRoot, 'https://other.test');

        $this->assertTrue($result['sanitizedEnv']);
        $this->assertSame("APP_KEY=base64:YWJj\nAPP_URL=https://existing.test\n", file_get_contents($this->apiRoot.'/.env'));
    }

    private function envWriter(): InstallerEnvWriter
    {
        return new InstallerEnvWriter(
            new AppPaths(new WgwInstallConfig, new WgwDatabaseProbe(new WgwInstallConfig)),
            new ApiRuntimeEnvService,
        );
    }

    private function mode(string $path): int
    {
        $perms = fileperms($path);
        $this->assertNotFalse($perms);

        return $perms & 0777;
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
