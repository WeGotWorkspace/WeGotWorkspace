<?php

declare(strict_types=1);

namespace Tests\Unit\Update;

use App\Services\Update\ShippedInstallEnvHardening;
use App\Support\WgwApiEnvFile;
use App\Support\WgwInstallConfig;
use Tests\TestCase;

final class ShippedInstallEnvHardeningTest extends TestCase
{
    private string $root = '';

    /** @var array<string, string|false> */
    private array $previousEnv = [];

    protected function setUp(): void
    {
        parent::setUp();

        $this->root = sys_get_temp_dir().'/wgw-h4-env-'.uniqid('', true);
        mkdir($this->root.'/packages/api', 0775, true);
        $this->rememberEnv('WGW_INSTALL_CHANNEL');
        $this->rememberEnv('WGW_APP_ROOT');
        putenv('WGW_INSTALL_CHANNEL');
        putenv('WGW_APP_ROOT');
        unset($_ENV['WGW_INSTALL_CHANNEL'], $_SERVER['WGW_INSTALL_CHANNEL'], $_ENV['WGW_APP_ROOT'], $_SERVER['WGW_APP_ROOT']);
    }

    protected function tearDown(): void
    {
        if ($this->root !== '' && is_dir($this->root)) {
            $this->removeTree($this->root);
        }
        $this->restoreEnv('WGW_INSTALL_CHANNEL');
        $this->restoreEnv('WGW_APP_ROOT');
        parent::tearDown();
    }

    public function test_zip_and_docker_rewrite_local_debug_and_leave_other_keys(): void
    {
        $this->writeEnv("APP_ENV=local\nAPP_DEBUG=true\nAPP_KEY=base64:abc\n");

        config([
            'wgw.install_root' => $this->root,
            'wgw.install_channel' => 'docker',
        ]);

        $this->assertTrue($this->fresh()->apply());
        $written = $this->readEnv();
        $this->assertSame('production', WgwApiEnvFile::readValue($written, 'APP_ENV'));
        $this->assertSame('false', WgwApiEnvFile::readValue($written, 'APP_DEBUG'));
        $this->assertSame('base64:abc', WgwApiEnvFile::readValue($written, 'APP_KEY'));
        $this->assertFalse($this->fresh()->apply());

        $this->writeEnv("APP_ENV=local\nAPP_DEBUG=\"true\"\n");
        config(['wgw.install_channel' => 'ZIP']);
        $this->assertTrue($this->fresh()->apply());
        $written = $this->readEnv();
        $this->assertSame('production', WgwApiEnvFile::readValue($written, 'APP_ENV'));
        $this->assertSame('false', WgwApiEnvFile::readValue($written, 'APP_DEBUG'));
    }

    public function test_empty_channel_rewrites_when_install_root_is_not_a_monorepo(): void
    {
        $this->writeEnv("APP_ENV=local\nAPP_DEBUG=true\nAPP_KEY=base64:abc\n");
        config([
            'wgw.install_root' => $this->root,
            'wgw.install_channel' => null,
        ]);

        $this->assertTrue($this->fresh()->apply());
        $written = $this->readEnv();
        $this->assertSame('production', WgwApiEnvFile::readValue($written, 'APP_ENV'));
        $this->assertSame('false', WgwApiEnvFile::readValue($written, 'APP_DEBUG'));
        $this->assertSame('base64:abc', WgwApiEnvFile::readValue($written, 'APP_KEY'));
    }

    public function test_empty_channel_leaves_monorepo_checkout_untouched(): void
    {
        $this->markMonorepoCheckout();
        $this->writeEnv("APP_ENV=local\nAPP_DEBUG=true\n");
        config([
            'wgw.install_root' => $this->root,
            'wgw.install_channel' => null,
        ]);

        $this->assertFalse($this->fresh()->apply());
        $this->assertSame('local', WgwApiEnvFile::readValue($this->readEnv(), 'APP_ENV'));
        $this->assertSame('true', WgwApiEnvFile::readValue($this->readEnv(), 'APP_DEBUG'));
    }

    public function test_source_checkout_and_non_local_env_are_not_rewritten_to_production(): void
    {
        $this->markMonorepoCheckout();
        $this->writeEnv("APP_ENV=local\nAPP_DEBUG=true\n");
        config([
            'wgw.install_root' => $this->root,
            'wgw.install_channel' => null,
        ]);

        $this->assertFalse($this->fresh()->apply());
        $this->assertSame('local', WgwApiEnvFile::readValue($this->readEnv(), 'APP_ENV'));
        $this->assertSame('true', WgwApiEnvFile::readValue($this->readEnv(), 'APP_DEBUG'));

        putenv('WGW_INSTALL_CHANNEL=docker');
        $_ENV['WGW_INSTALL_CHANNEL'] = 'docker';
        $this->assertTrue($this->fresh()->apply());
        $this->assertSame('production', WgwApiEnvFile::readValue($this->readEnv(), 'APP_ENV'));

        $this->writeEnv("APP_ENV=staging\nAPP_DEBUG=true\n");
        $this->assertTrue($this->fresh()->apply());
        $written = $this->readEnv();
        $this->assertSame('staging', WgwApiEnvFile::readValue($written, 'APP_ENV'));
        $this->assertSame('false', WgwApiEnvFile::readValue($written, 'APP_DEBUG'));
    }

    private function fresh(): ShippedInstallEnvHardening
    {
        $this->app->forgetInstance(WgwInstallConfig::class);
        $this->app->forgetInstance(ShippedInstallEnvHardening::class);

        return $this->app->make(ShippedInstallEnvHardening::class);
    }

    private function markMonorepoCheckout(): void
    {
        file_put_contents($this->root.'/pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
        mkdir($this->root.'/apps/wegotworkspace', 0775, true);
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

                continue;
            }
            unlink($path);
        }
        rmdir($dir);
    }

    private function writeEnv(string $content): void
    {
        file_put_contents($this->root.'/packages/api/.env', $content);
    }

    private function readEnv(): string
    {
        return (string) file_get_contents($this->root.'/packages/api/.env');
    }

    private function rememberEnv(string $key): void
    {
        $value = getenv($key);
        $this->previousEnv[$key] = is_string($value) ? $value : false;
    }

    private function restoreEnv(string $key): void
    {
        $previous = $this->previousEnv[$key] ?? false;
        if (is_string($previous) && $previous !== '') {
            putenv($key.'='.$previous);
            $_ENV[$key] = $previous;
            $_SERVER[$key] = $previous;

            return;
        }

        putenv($key);
        unset($_ENV[$key], $_SERVER[$key]);
    }
}
