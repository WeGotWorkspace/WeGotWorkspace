<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\AppPaths;
use App\Support\WgwApiEnvFile;
use App\Support\WgwConnectionConfigurator;
use App\Support\WgwInstallConfig;
use App\Support\WgwRuntimeEnvBridge;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class AppPathsDatabaseReadyTest extends TestCase
{
    private string $installRoot;

    protected function setUp(): void
    {
        $this->installRoot = sys_get_temp_dir().'/wgw-app-paths-test-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);
        mkdir($this->installRoot.'/wgw-content/keys', 0700, true);

        putenv('WGW_APP_ROOT='.$this->installRoot);
        $_ENV['WGW_APP_ROOT'] = $this->installRoot;

        parent::setUp();

        config(['wgw.install_root' => $this->installRoot]);
        WgwInstallFixture::ensureApiPackage($this->installRoot);
        WgwInstallFixture::forgetInstallBindings();
    }

    protected function tearDown(): void
    {
        putenv('WGW_APP_ROOT');
        unset($_ENV['WGW_APP_ROOT']);
        WgwInstallFixture::forgetInstallBindings();

        if (is_dir($this->installRoot)) {
            $this->removeTree($this->installRoot);
        }

        parent::tearDown();
    }

    public function test_mysql_runtime_env_does_not_require_sqlite_file(): void
    {
        WgwInstallFixture::writeRuntimeEnv($this->installRoot, [
            'WGW_DATA_DIR' => 'wgw-content',
            'WGW_DB_CONNECTION' => 'mysql',
            'WGW_DB_HOST' => '127.0.0.1',
            'WGW_DB_PORT' => '3306',
            'WGW_DB_DATABASE' => 'missing_wegotworkspace',
            'WGW_DB_USERNAME' => 'db_user',
            'WGW_DB_PASSWORD' => 'db_password',
        ]);
        file_put_contents($this->installRoot.'/wgw-content/.installed', date('c')."\n");
        file_put_contents($this->installRoot.'/wgw-content/keys/api-jwt-private.pem', str_repeat('a', 64));
        file_put_contents($this->installRoot.'/wgw-content/keys/api-jwt-public.pem', str_repeat('b', 64));

        $paths = app(AppPaths::class);

        $this->assertFileDoesNotExist($this->installRoot.'/wgw-content/db.sqlite');
        $this->assertFalse($paths->databaseReady());
        $this->assertFalse($paths->isInstalled());
    }

    public function test_sqlite_install_is_detected_when_users_exist(): void
    {
        WgwInstallFixture::markInstalled($this->installRoot, $this->installRoot.'/wgw-content');

        $install = app(WgwInstallConfig::class);
        $this->assertFalse(WgwApiEnvFile::hasRealDatabaseConfig($install->apiEnvPath()));
        $this->assertTrue($install->hasConfiguredRuntimeEnv());

        $paths = app(AppPaths::class);

        $this->assertTrue($paths->databaseReady());
        $this->assertTrue($paths->isInstalled());
    }

    public function test_runtime_ready_without_lock_recreates_installed_marker(): void
    {
        WgwInstallFixture::markInstalled($this->installRoot, $this->installRoot.'/wgw-content');
        @unlink($this->installRoot.'/wgw-content/.installed');

        $paths = app(AppPaths::class);

        $this->assertTrue($paths->runtimeInstallReady());
        $this->assertTrue($paths->isInstalled());
        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');
    }

    public function test_installer_probe_connection_is_not_a_configured_install(): void
    {
        WgwInstallFixture::markInstalled($this->installRoot, $this->installRoot.'/wgw-content');
        @unlink($this->installRoot.'/packages/api/.env');
        // The fixture writes the lock. Remove it so the assertion measures
        // whether the probe plants one.
        @unlink($this->installRoot.'/wgw-content/.installed');

        WgwConnectionConfigurator::applyFromInstallerDb([
            'driver' => 'sqlite',
            'sqlite_path' => $this->installRoot.'/wgw-content/db.sqlite',
        ]);

        $paths = app(AppPaths::class);
        $this->assertFalse($paths->isInstalled());
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-content/.installed');

        file_put_contents($this->installRoot.'/wgw-content/.installed', "keep\n");
        $paths->clearStaleInstallLock();
        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');
        @unlink($this->installRoot.'/wgw-content/.installed');

        WgwRuntimeEnvBridge::apply(app(WgwInstallConfig::class));

        $this->assertFalse(config('wgw.installer_db_applied'));
        $this->assertTrue(app(AppPaths::class)->isInstalled());
        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');
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
