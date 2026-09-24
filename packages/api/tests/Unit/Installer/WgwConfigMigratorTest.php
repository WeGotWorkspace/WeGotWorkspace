<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\WgwConfigMigrator;
use App\Support\UpdateFeedDefaults;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class WgwConfigMigratorTest extends TestCase
{
    private string $installRoot;

    protected function setUp(): void
    {
        $this->installRoot = sys_get_temp_dir().'/wgw-config-migrate-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);

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

    public function test_migrates_sqlite_array_config_to_env(): void
    {
        file_put_contents($this->installRoot.'/wgw-config.php', <<<'PHP'
<?php

declare(strict_types=1);

return [
    'data_dir' => './wgw-content',
    'update_feed_url' => 'https://example.test/manifest.json',
    'pdo' => ['sqlite_file' => './wgw-content/db.sqlite'],
];
PHP);

        $this->assertTrue(app(WgwConfigMigrator::class)->migrateIfNeeded());
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-config.php');

        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DATA_DIR=./wgw-content', $env);
        $this->assertStringContainsString('WGW_DB_CONNECTION=sqlite', $env);
        $this->assertStringContainsString('WGW_DB_DATABASE=./wgw-content/db.sqlite', $env);
        $this->assertStringContainsString('WGW_UPDATE_FEED_URL=https://example.test/manifest.json', $env);
        $this->assertNotEmpty(glob($this->installRoot.'/wgw-config.php.bak.*'));
    }

    public function test_migrates_mysql_dsn_config_to_env(): void
    {
        file_put_contents($this->installRoot.'/wgw-config.php', <<<'PHP'
<?php

declare(strict_types=1);

return [
    'data_dir' => './wgw-content',
    'pdo' => [
        'dsn' => 'mysql:host=db;port=3307;dbname=wgw;charset=utf8mb4',
        'user' => 'wgw',
        'password' => 'secret',
    ],
];
PHP);

        $this->assertTrue(app(WgwConfigMigrator::class)->migrateIfNeeded());

        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=mysql', $env);
        $this->assertStringContainsString('WGW_DB_HOST=db', $env);
        $this->assertStringContainsString('WGW_DB_PORT=3307', $env);
        $this->assertStringContainsString('WGW_DB_DATABASE=wgw', $env);
        $this->assertStringContainsString('WGW_DB_USERNAME=wgw', $env);
        $this->assertStringContainsString('WGW_DB_PASSWORD=secret', $env);
    }

    public function test_migrates_define_style_config_to_env(): void
    {
        file_put_contents($this->installRoot.'/wgw-config.php', <<<'PHP'
<?php

declare(strict_types=1);

defined('WGW_DATA_DIR') || define('WGW_DATA_DIR', 'wgw-content');
defined('WGW_DB_DSN') || define('WGW_DB_DSN', 'mysql:host=127.0.0.1;port=3306;dbname=wegotworkspace;charset=utf8mb4');
defined('WGW_DB_USER') || define('WGW_DB_USER', 'db_user');
defined('WGW_DB_PASSWORD') || define('WGW_DB_PASSWORD', 'db_password');
PHP);

        $this->assertTrue(app(WgwConfigMigrator::class)->migrateIfNeeded());

        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=mysql', $env);
        $this->assertStringContainsString('WGW_DB_DATABASE=wegotworkspace', $env);
    }

    public function test_migrate_is_idempotent_when_legacy_file_absent(): void
    {
        $this->assertFalse(app(WgwConfigMigrator::class)->migrateIfNeeded());
        $this->assertFalse(app(WgwConfigMigrator::class)->migrateIfNeeded());
    }

    public function test_migrate_uses_default_feed_when_legacy_omits_url(): void
    {
        file_put_contents($this->installRoot.'/wgw-config.php', <<<'PHP'
<?php

declare(strict_types=1);

return [
    'data_dir' => './wgw-content',
    'pdo' => ['sqlite_file' => './wgw-content/db.sqlite'],
];
PHP);

        app(WgwConfigMigrator::class)->migrateIfNeeded();

        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_UPDATE_FEED_URL='.UpdateFeedDefaults::MANIFEST_URL, $env);
    }

    public function test_migrates_array_config_without_explicit_pdo_key(): void
    {
        file_put_contents($this->installRoot.'/wgw-config.php', <<<'PHP'
<?php

declare(strict_types=1);

return [
    'data_dir' => './wgw-content',
];
PHP);

        $this->assertTrue(app(WgwConfigMigrator::class)->migrateIfNeeded());

        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=sqlite', $env);
        $this->assertStringContainsString('WGW_DB_DATABASE=./wgw-content/db.sqlite', $env);
    }

    public function test_recovers_database_config_from_legacy_backup_when_active_file_removed(): void
    {
        file_put_contents($this->installRoot.'/wgw-config.php.bak.20260709-120000', <<<'PHP'
<?php

declare(strict_types=1);

return [
    'data_dir' => './wgw-content',
    'pdo' => ['sqlite_file' => './wgw-content/db.sqlite'],
];
PHP);

        $envPath = $this->installRoot.'/packages/api/.env';
        if (! is_file($envPath) && is_file($this->installRoot.'/packages/api/.env.example')) {
            copy($this->installRoot.'/packages/api/.env.example', $envPath);
        }
        $env = (string) file_get_contents($envPath);
        $env = (string) preg_replace('/^WGW_DB_.*$/m', '', $env);
        $env = (string) preg_replace('/^WGW_DATA_DIR=.*$/m', '', $env);
        file_put_contents($envPath, $env);

        $this->assertTrue(app(WgwConfigMigrator::class)->migrateIfNeeded());

        $env = (string) file_get_contents($envPath);
        $this->assertStringContainsString('WGW_DB_CONNECTION=sqlite', $env);
        $this->assertStringContainsString('WGW_DB_DATABASE=./wgw-content/db.sqlite', $env);
        $this->assertFileExists($this->installRoot.'/wgw-config.php.bak.20260709-120000');
    }

    public function test_migrate_is_skipped_when_env_already_has_database_config_and_only_backup_exists(): void
    {
        WgwInstallFixture::writeRuntimeEnv($this->installRoot, [
            'WGW_DATA_DIR' => './wgw-content',
            'WGW_DB_CONNECTION' => 'mysql',
            'WGW_DB_HOST' => 'db.example',
            'WGW_DB_DATABASE' => 'wgw',
        ]);

        file_put_contents($this->installRoot.'/wgw-config.php.bak.20260709-120000', <<<'PHP'
<?php

declare(strict_types=1);

return [
    'data_dir' => './other-content',
    'pdo' => ['sqlite_file' => './other-content/db.sqlite'],
];
PHP);

        $this->assertFalse(app(WgwConfigMigrator::class)->migrateIfNeeded());
    }

    public function test_does_not_remigrate_from_backup_when_env_already_has_db_keys(): void
    {
        file_put_contents($this->installRoot.'/wgw-config.php.bak.20260709-130000', <<<'PHP'
<?php

declare(strict_types=1);

return [
    'data_dir' => './other-content',
    'pdo' => ['sqlite_file' => './other-content/db.sqlite'],
];
PHP);

        $envPath = $this->installRoot.'/packages/api/.env';
        if (! is_file($envPath) && is_file($this->installRoot.'/packages/api/.env.example')) {
            copy($this->installRoot.'/packages/api/.env.example', $envPath);
        }
        $before = (string) file_get_contents($envPath);
        $bakBefore = glob($envPath.'.bak.*');

        $this->assertFalse(app(WgwConfigMigrator::class)->migrateIfNeeded());
        $this->assertSame($before, file_get_contents($envPath));
        $this->assertSame($bakBefore, glob($envPath.'.bak.*'));
    }

    public function test_matching_legacy_file_is_removed_without_rewriting_env(): void
    {
        $envPath = $this->installRoot.'/packages/api/.env';
        file_put_contents($envPath, <<<'ENV'
APP_KEY=base64:keep
WGW_DATA_DIR=./wgw-content
WGW_DB_CONNECTION=sqlite
WGW_DB_DATABASE=./wgw-content/db.sqlite
WGW_UPDATE_FEED_URL=https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/manifest.json
ENV
        );
        file_put_contents($this->installRoot.'/wgw-config.php', <<<'PHP'
<?php

declare(strict_types=1);

return [
    'data_dir' => './wgw-content',
    'pdo' => ['sqlite_file' => './wgw-content/db.sqlite'],
];
PHP);

        $before = (string) file_get_contents($envPath);
        $this->assertTrue(app(WgwConfigMigrator::class)->migrateIfNeeded());
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-config.php');
        $this->assertSame($before, file_get_contents($envPath));
        $this->assertSame([], glob($envPath.'.bak.*'));
    }

    public function test_active_legacy_config_is_migrated_even_when_env_has_example_defaults(): void
    {
        file_put_contents($this->installRoot.'/packages/api/.env', <<<'ENV'
APP_KEY=base64:test
WGW_DATA_DIR=./wgw-content
WGW_DB_CONNECTION=sqlite
WGW_DB_DATABASE=./wgw-content/db.sqlite
ENV
        );
        file_put_contents($this->installRoot.'/wgw-config.php', <<<'PHP'
<?php

declare(strict_types=1);

return [
    'data_dir' => './wgw-content',
    'pdo' => [
        'dsn' => 'mysql:host=db.example;port=3306;dbname=wgw;charset=utf8mb4',
        'user' => 'wgw',
        'password' => 'secret',
    ],
];
PHP);

        $this->assertTrue(app(WgwConfigMigrator::class)->migrateIfNeeded());

        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=mysql', $env);
        $this->assertStringContainsString('WGW_DB_HOST=db.example', $env);
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
