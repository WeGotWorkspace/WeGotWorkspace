<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\ApiRuntimeEnvService;
use App\Services\Installer\EnvFileWriter;
use App\Support\WgwApiEnvFile;
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

    public function test_ensure_leaves_env_mode_0600_and_lock_mode_0660(): void
    {
        $previous = umask(0);
        try {
            file_put_contents($this->apiRoot.'/.env', "APP_KEY=\nAPP_URL=http://localhost\nWGW_DB_PASSWORD=secret\n");
            chmod($this->apiRoot.'/.env', 0666);

            (new ApiRuntimeEnvService)->ensureAtApiRoot($this->apiRoot, 'https://files.example.test');

            $this->assertSame(0600, fileperms($this->apiRoot.'/.env') & 0777);
            $this->assertSame(0660, fileperms($this->apiRoot.'/.env.lock') & 0777);
        } finally {
            umask($previous);
        }
    }

    public function test_ensure_follows_a_symlink_chain_to_the_real_file(): void
    {
        $volume = sys_get_temp_dir().'/wgw-env-chain-'.uniqid('', true);
        mkdir($volume, 0775, true);
        $body = "APP_KEY=\nAPP_URL=http://localhost\nWGW_INSTALL_DB_DRIVER=mysql\n";
        file_put_contents($volume.'/api.env', $body);
        symlink($volume.'/api.env', $volume.'/link1');
        symlink($volume.'/link1', $this->apiRoot.'/.env');

        try {
            (new ApiRuntimeEnvService)->ensureAtApiRoot($this->apiRoot, 'http://127.0.0.1:18080');

            $this->assertTrue(is_link($this->apiRoot.'/.env'));
            $this->assertTrue(is_link($volume.'/link1'));
            $written = (string) file_get_contents($volume.'/api.env');
            $this->assertMatchesRegularExpression('/^APP_KEY=base64:/m', $written);
            $this->assertStringContainsString('WGW_INSTALL_DB_DRIVER=mysql', $written);
            $this->assertSame(0600, fileperms($volume.'/api.env') & 0777);
        } finally {
            @unlink($volume.'/api.env.lock');
            @unlink($volume.'/api.env');
            @unlink($volume.'/link1');
            @rmdir($volume);
        }
    }

    public function test_ensure_and_installer_env_writer_keep_each_others_keys(): void
    {
        $lines = [
            'APP_NAME=Laravel',
            'APP_KEY=',
            'APP_URL=http://localhost',
            'WGW_INSTALL_DB_DRIVER=mysql',
        ];
        for ($n = 0; $n < 4000; $n++) {
            $lines[] = 'WGW_PAD_'.$n.'='.str_repeat('x', 40);
        }
        file_put_contents($this->apiRoot.'/.env', implode("\n", $lines)."\n");

        $worker = tempnam(sys_get_temp_dir(), 'wgw-env-both-');
        $this->assertNotFalse($worker);
        file_put_contents($worker, <<<'PHP'
<?php
require $argv[1];
$apiRoot = $argv[2];
$env = $apiRoot.'/.env';
if ($argv[3] === 'ensure') {
    $service = new App\Services\Installer\ApiRuntimeEnvService;
    for ($i = 0; $i < 20; $i++) {
        $service->ensureAtApiRoot($apiRoot, 'http://127.0.0.1:18080');
    }
    exit(0);
}
$writer = (new ReflectionClass(App\Services\Installer\InstallerEnvWriter::class))->newInstanceWithoutConstructor();
for ($i = 0; $i < 20; $i++) {
    $writer->patchEnvFile($env, [
        'WGW_DB_HOST' => 'db.example',
        'WGW_DB_DATABASE' => 'wgw',
        'WGW_DB_PASSWORD' => 'from-installer',
    ]);
}
PHP);

        $autoload = dirname(__DIR__, 3).'/vendor/autoload.php';
        $envPath = $this->apiRoot.'/.env';
        $procs = [];
        $sawEmpty = 0;
        $sawPartial = 0;
        $sawLooseTemp = 0;
        $sawTemp = 0;
        try {
            foreach (['ensure', 'patch'] as $mode) {
                $procs[] = proc_open(
                    [PHP_BINARY, $worker, $autoload, $this->apiRoot, $mode],
                    [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                    $pipes,
                );
                $this->assertIsResource($procs[array_key_last($procs)]);
                fclose($pipes[1]);
                fclose($pipes[2]);
            }

            $deadline = microtime(true) + 8;
            do {
                $running = false;
                foreach ($procs as $proc) {
                    if (proc_get_status($proc)['running']) {
                        $running = true;
                    }
                }
                clearstatcache();
                $content = @file_get_contents($envPath);
                if (! is_string($content) || $content === '') {
                    $sawEmpty++;
                } elseif (! str_contains($content, 'WGW_PAD_3999=')) {
                    $sawPartial++;
                }
                foreach (glob($this->apiRoot.'/.env.tmp.*') ?: [] as $tmp) {
                    $mode = @fileperms($tmp);
                    $size = @filesize($tmp);
                    if ($mode === false || $size === false) {
                        continue;
                    }
                    $sawTemp++;
                    if (($mode & 0777) !== 0600 && $size > 0) {
                        $sawLooseTemp++;
                    }
                }
                if (! $running) {
                    break;
                }
            } while (microtime(true) < $deadline);
        } finally {
            $exits = [];
            foreach ($procs as $proc) {
                if (is_resource($proc)) {
                    $exits[] = proc_close($proc);
                }
            }
            @unlink($worker);
        }

        foreach ($exits as $exit) {
            $this->assertSame(0, $exit);
        }
        $this->assertSame(0, $sawEmpty);
        $this->assertSame(0, $sawPartial);
        $this->assertSame(0, $sawLooseTemp);
        $this->assertGreaterThan(0, $sawTemp);

        $env = (string) file_get_contents($envPath);
        $this->assertMatchesRegularExpression('/^APP_KEY=base64:[A-Za-z0-9+\/=]+$/m', $env);
        $this->assertSame('db.example', WgwApiEnvFile::readValue($env, 'WGW_DB_HOST'));
        $this->assertSame('wgw', WgwApiEnvFile::readValue($env, 'WGW_DB_DATABASE'));
        $this->assertSame('from-installer', WgwApiEnvFile::readValue($env, 'WGW_DB_PASSWORD'));
        $this->assertStringContainsString('WGW_INSTALL_DB_DRIVER=mysql', $env);
        $this->assertStringContainsString('WGW_PAD_3999=', $env);
        $this->assertSame(0600, fileperms($envPath) & 0777);
    }

    public function test_writer_creates_the_target_of_a_dangling_symlink(): void
    {
        $volume = sys_get_temp_dir().'/wgw-env-dangling-'.uniqid('', true);
        mkdir($volume, 0775, true);
        $target = $volume.'/api.env';
        symlink($target, $this->apiRoot.'/.env');

        try {
            $wrote = (new EnvFileWriter)->update(
                $this->apiRoot.'/.env',
                static fn (string $content): string => "APP_KEY=base64:YQ==\nAPP_URL=http://localhost\n",
            );

            $this->assertTrue($wrote);
            $this->assertTrue(is_link($this->apiRoot.'/.env'));
            $this->assertFileExists($target);
            $this->assertSame(0600, fileperms($target) & 0777);
            $this->assertStringContainsString('APP_KEY=base64:YQ==', (string) file_get_contents($target));
        } finally {
            @unlink($volume.'/api.env.lock');
            @unlink($target);
            @rmdir($volume);
        }
    }

    public function test_update_preserves_existing_owner_and_group(): void
    {
        if (! function_exists('posix_geteuid') || posix_geteuid() !== 0) {
            $this->markTestSkipped('Preserving another uid requires root.');
        }

        $owner = posix_getpwnam('www-data') ?: posix_getpwnam('nobody');
        $group = posix_getpwnam('nobody') ?: $owner;
        if (! is_array($owner) || ! is_array($group)) {
            $this->markTestSkipped('No unprivileged account is available to chown the fixture.');
        }

        $uid = (int) $owner['uid'];
        $gid = (int) $group['gid'];
        if ($uid === 0) {
            $this->markTestSkipped('The alternate account is root.');
        }

        $path = $this->apiRoot.'/.env';
        file_put_contents($path, "APP_KEY=base64:YQ==\n");
        $this->assertTrue(chmod($path, 0600));
        $this->assertTrue(chown($path, $uid));
        $this->assertTrue(chgrp($path, $gid));
        clearstatcache(true, $path);
        $this->assertSame($uid, fileowner($path));
        $this->assertSame($gid, filegroup($path));
        $this->assertNotSame(posix_geteuid(), $uid);

        $wrote = (new EnvFileWriter)->update(
            $path,
            static fn (string $content): string => $content."APP_URL=http://127.0.0.1:18080\n",
        );

        $this->assertTrue($wrote);
        clearstatcache(true, $path);
        $this->assertSame($uid, fileowner($path));
        $this->assertSame($gid, filegroup($path));
        $this->assertSame(0600, fileperms($path) & 0777);
        $this->assertStringContainsString('APP_URL=http://127.0.0.1:18080', (string) file_get_contents($path));
    }

    public function test_ensure_strips_invalid_dotenv_lines(): void
    {
        file_put_contents($this->apiRoot.'/.env', "APP_KEY=base64:YWJj\nAPP_URL=https://existing.test\nreply@example.com\n");

        $service = new ApiRuntimeEnvService;
        $result = $service->ensure($this->installRoot, 'https://other.test');

        $this->assertTrue($result['sanitizedEnv']);
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
