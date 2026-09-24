<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\ProductionInstallBootstrap;
use App\Services\Installer\WgwInstallEnv;
use App\Support\AppPaths;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class WgwInstallEnvTest extends TestCase
{
    private string $installRoot;

    protected function setUp(): void
    {
        $this->installRoot = sys_get_temp_dir().'/wgw-install-env-test-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);
        mkdir($this->installRoot.'/wgw-content', 0775, true);
        file_put_contents($this->installRoot.'/index.php', "<?php\n");

        putenv('WGW_APP_ROOT='.$this->installRoot);
        $_ENV['WGW_APP_ROOT'] = $this->installRoot;

        parent::setUp();

        config(['wgw.install_root' => $this->installRoot]);
        WgwInstallFixture::ensureApiPackage($this->installRoot);
        WgwInstallFixture::forgetInstallBindings();
    }

    protected function tearDown(): void
    {
        config(['wgw.install' => []]);
        putenv('WGW_APP_ROOT');
        unset($_ENV['WGW_APP_ROOT']);
        WgwInstallFixture::forgetInstallBindings();

        if (is_dir($this->installRoot)) {
            $this->removeTree($this->installRoot);
        }

        parent::tearDown();
    }

    public function test_wizard_defaults_merge_mysql_and_site_fields(): void
    {
        $this->setInstallConfig([
            'db_driver' => 'mysql',
            'db_host' => 'db',
            'db_port' => '3306',
            'db_database' => 'wgw',
            'db_user' => 'wgw',
            'db_password' => 'secret',
            'timezone' => 'Europe/Amsterdam',
            'base_uri' => '/wgw/',
            'admin_username' => 'Admin',
            'admin_email' => 'admin@example.test',
        ]);

        $defaults = app(WgwInstallEnv::class)->wizardDefaults('');

        $this->assertSame('mysql', $defaults['db_driver']);
        $this->assertSame('db', $defaults['db']['mysql_host'] ?? null);
        $this->assertSame('wgw', $defaults['db']['mysql_db'] ?? null);
        $this->assertSame('Europe/Amsterdam', $defaults['timezone']);
        $this->assertSame('/wgw/', $defaults['base_uri']);
        $this->assertSame('admin', $defaults['admin_username'] ?? null);
        $this->assertSame('admin@example.test', $defaults['admin_email'] ?? null);
        $this->assertArrayNotHasKey('admin_password', $defaults);
        $this->assertTrue(app(WgwInstallEnv::class)->hasDatabaseFromEnv());
    }

    public function test_has_database_from_env_is_false_without_driver(): void
    {
        $this->setInstallConfig([
            'db_driver' => '',
        ]);

        $this->assertFalse(app(WgwInstallEnv::class)->hasDatabaseFromEnv());
    }

    public function test_headless_plan_requires_complete_env(): void
    {
        $this->setInstallConfig([
            'headless' => true,
            'db_driver' => 'sqlite',
            'base_uri' => '/',
        ]);

        $this->assertNull(app(WgwInstallEnv::class)->headlessPlan(''));

        $this->setInstallConfig([
            'headless' => true,
            'db_driver' => 'sqlite',
            'base_uri' => '/',
            'admin_username' => 'admin',
            'admin_email' => 'admin@example.test',
            'admin_password' => 'longpassword',
        ]);

        $plan = app(WgwInstallEnv::class)->headlessPlan('');
        $this->assertIsArray($plan);
        $this->assertSame('sqlite', $plan['state']['db_driver'] ?? null);
        $this->assertSame('admin', $plan['payload']['username'] ?? null);
    }

    public function test_bootstrap_endpoint_prefills_mysql_from_env(): void
    {
        $this->setInstallConfig([
            'db_driver' => 'mysql',
            'db_host' => 'db',
            'db_database' => 'wgw',
            'db_user' => 'wgw',
            'db_password' => 'secret',
            'timezone' => 'UTC',
        ]);

        config(['wgw.data_dir' => $this->installRoot.'/wgw-content']);

        $this->getJson('/api/v1/installer/bootstrap')
            ->assertOk()
            ->assertJsonPath('state.db_driver', 'mysql')
            ->assertJsonPath('state.db.mysql_host', 'db')
            ->assertJsonPath('state.db.mysql_db', 'wgw')
            ->assertJsonPath('state.db.mysql_user', 'wgw');
    }

    public function test_wgw_install_command_runs_headless_sqlite_install(): void
    {
        putenv('WGW_DISABLE_INSTALL_THROTTLE=1');
        $_ENV['WGW_DISABLE_INSTALL_THROTTLE'] = '1';
        $this->setInstallConfig([
            'headless' => true,
            'db_driver' => 'sqlite',
            'base_uri' => '/',
            'admin_username' => 'admin',
            'admin_email' => 'admin@example.test',
            'admin_password' => 'longpassword',
        ]);

        config(['wgw.data_dir' => $this->installRoot.'/wgw-content']);

        $bootstrap = app(ProductionInstallBootstrap::class);
        $this->assertSame('installed', $bootstrap->run(''));

        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');
        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=sqlite', $env);
        $this->assertStringContainsString('WGW_DB_DATABASE=', $env);
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-config.php');
        $this->assertTrue(app(AppPaths::class)->isInstalled());
        $this->assertSame('skipped', $bootstrap->run(''));
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function setInstallConfig(array $overrides): void
    {
        config(['wgw.install' => array_merge((array) config('wgw.install', []), $overrides)]);
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
