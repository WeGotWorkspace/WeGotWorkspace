<?php

declare(strict_types=1);

namespace Tests\Feature\Installer;

use Tests\Support\InstallerMysqlTestDatabase;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class InstallerEndpointsTest extends TestCase
{
    private string $installRoot;

    private ?string $mysqlInstallDatabase = null;

    protected function setUp(): void
    {
        $this->installRoot = sys_get_temp_dir().'/wgw-installer-test-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);
        mkdir($this->installRoot.'/wgw-content', 0775, true);
        file_put_contents($this->installRoot.'/index.php', "<?php\n");

        putenv('WGW_APP_ROOT='.$this->installRoot);
        $_ENV['WGW_APP_ROOT'] = $this->installRoot;
        putenv('WGW_DISABLE_INSTALL_THROTTLE=1');
        $_ENV['WGW_DISABLE_INSTALL_THROTTLE'] = '1';

        parent::setUp();

        WgwInstallFixture::ensureApiPackage($this->installRoot);
        config(['wgw.install_root' => $this->installRoot, 'wgw.data_dir' => $this->installRoot.'/wgw-content']);
    }

    protected function tearDown(): void
    {
        $lock = $this->installRoot.'/wgw-content/.installed';
        if (is_file($lock)) {
            @unlink($lock);
        }
        if (is_file($this->installRoot.'/packages/api/.env')) {
            @unlink($this->installRoot.'/packages/api/.env');
        }

        if ($this->mysqlInstallDatabase !== null) {
            InstallerMysqlTestDatabase::drop($this->mysqlInstallDatabase);
            $this->mysqlInstallDatabase = null;
        }

        config(['wgw.install' => []]);
        WgwInstallFixture::forgetInstallBindings();

        parent::tearDown();
    }

    public function test_state_and_bootstrap_expose_welcome_step(): void
    {
        $state = $this->getJson('/api/v1/installer/state');
        $state->assertOk()
            ->assertJsonPath('installed', false)
            ->assertJsonPath('maintenance', false)
            ->assertJsonPath('state.step', 'welcome')
            ->assertJsonStructure(['state' => ['checks']]);

        $bootstrap = $this->getJson('/api/v1/installer/bootstrap');
        $bootstrap->assertOk()
            ->assertJsonPath('state.step', 'welcome');
    }

    public function test_stale_lock_without_keys_allows_installer(): void
    {
        file_put_contents($this->installRoot.'/wgw-content/.installed', date('c')."\n");

        $this->getJson('/api/v1/installer/bootstrap')
            ->assertOk()
            ->assertJsonPath('state.step', 'welcome');

        $this->assertFileDoesNotExist($this->installRoot.'/wgw-content/.installed');
    }

    public function test_wizard_advances_through_sqlite_install(): void
    {
        $sqlitePath = './wgw-content/install-test.sqlite';

        $this->postJson('/api/v1/installer/action', [
            'action' => 'welcome_next',
            'payload' => [],
        ])->assertOk()->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'requirements');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'requirements_next',
            'payload' => ['db_driver' => 'sqlite'],
        ])->assertOk()->assertJsonPath('state.step', 'database');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'database_next',
            'payload' => [
                'db_driver' => 'sqlite',
                'sqlite_path' => $sqlitePath,
            ],
        ])->assertOk()->assertJsonPath('state.step', 'site');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'site_next',
            'payload' => [
                'timezone' => 'UTC',
                'enable_files' => true,
                'enable_calendars' => true,
                'enable_contacts' => false,
                'show_browser_ui' => true,
            ],
        ])->assertOk()->assertJsonPath('state.step', 'account');

        $install = $this->postJson('/api/v1/installer/action', [
            'action' => 'install',
            'payload' => [
                'username' => 'admin',
                'display_name' => 'Admin',
                'email' => 'admin@example.test',
                'password' => 'longpassword',
                'password_confirm' => 'longpassword',
                'mail_enabled' => false,
                'meet_enabled' => false,
            ],
        ]);

        $install->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonStructure(['redirect', 'state']);

        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');
        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=sqlite', $env);
        $this->assertStringContainsString('install-test.sqlite', $env);
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-config.php');
        $this->assertFileExists($this->installRoot.'/wgw-content/install-test.sqlite');
        $this->assertFileExists($this->installRoot.'/wgw-content/keys/api-jwt-private.pem');
        $this->assertFileExists($this->installRoot.'/wgw-content/keys/api-jwt-public.pem');

        $db = new \PDO('sqlite:'.$this->installRoot.'/wgw-content/install-test.sqlite');
        $stmt = $db->query("SELECT value FROM app_settings WHERE name = 'auth_realm'");
        $this->assertSame('SabreDAV', $stmt->fetchColumn());
        $stmt = $db->query("SELECT value FROM app_settings WHERE name = 'base_uri'");
        $this->assertSame('/', $stmt->fetchColumn());

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', true)
            ->assertJsonPath('state.step', 'installed');
    }

    public function test_wizard_advances_through_mysql_install(): void
    {
        if (! InstallerMysqlTestDatabase::isAvailable()) {
            $this->markTestSkipped(
                'MySQL not available — run in api-mysql CI or set WGW_TEST_MYSQL_* against a local server.',
            );
        }

        $this->mysqlInstallDatabase = InstallerMysqlTestDatabase::createIsolated();
        $mysql = InstallerMysqlTestDatabase::installerPayload($this->mysqlInstallDatabase);

        $this->postJson('/api/v1/installer/action', [
            'action' => 'welcome_next',
            'payload' => [],
        ])->assertOk()->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'requirements');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'requirements_next',
            'payload' => ['db_driver' => 'mysql'],
        ])->assertOk()->assertJsonPath('state.step', 'database');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'database_next',
            'payload' => $mysql,
        ])->assertOk()->assertJsonPath('state.step', 'site');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'site_next',
            'payload' => [
                'timezone' => 'UTC',
                'enable_files' => true,
                'enable_calendars' => true,
                'enable_contacts' => false,
                'show_browser_ui' => true,
            ],
        ])->assertOk()->assertJsonPath('state.step', 'account');

        $install = $this->postJson('/api/v1/installer/action', [
            'action' => 'install',
            'payload' => [
                'username' => 'admin',
                'display_name' => 'Admin',
                'email' => 'admin@example.test',
                'password' => 'longpassword',
                'password_confirm' => 'longpassword',
                'mail_enabled' => false,
                'meet_enabled' => false,
            ],
        ]);

        $install->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonStructure(['redirect', 'state']);

        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');
        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=mysql', $env);
        $this->assertStringContainsString($this->mysqlInstallDatabase, $env);
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-config.php');

        $admin = [
            'host' => getenv('WGW_TEST_MYSQL_HOST') ?: '127.0.0.1',
            'port' => (int) (getenv('WGW_TEST_MYSQL_PORT') ?: 3306),
            'user' => getenv('WGW_TEST_MYSQL_USERNAME') ?: 'root',
            'password' => getenv('WGW_TEST_MYSQL_PASSWORD') ?: '',
        ];
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $admin['host'],
            $admin['port'],
            $this->mysqlInstallDatabase,
        );
        $db = new \PDO($dsn, $admin['user'], $admin['password'], wgw_mysql_pdo_options());
        $stmt = $db->query("SELECT value FROM app_settings WHERE name = 'auth_realm'");
        $this->assertSame('SabreDAV', $stmt->fetchColumn());
        $stmt = $db->query("SELECT value FROM app_settings WHERE name = 'base_uri'");
        $this->assertSame('/', $stmt->fetchColumn());
        $stmt = $db->query('SELECT COUNT(*) FROM users');
        $this->assertSame('1', (string) $stmt->fetchColumn());

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', true)
            ->assertJsonPath('state.step', 'installed');

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        WgwInstallFixture::syncDatabaseConnection();

        $this->postJson('/api/v1/auth/token', [
            'username' => 'admin',
            'password' => 'longpassword',
        ])->assertOk()->assertJsonPath('username', 'admin');
    }

    public function test_database_test_failure_preserves_mysql_driver_choice(): void
    {
        $this->postJson('/api/v1/installer/action', [
            'action' => 'welcome_next',
            'payload' => [],
        ])->assertOk();

        $this->postJson('/api/v1/installer/action', [
            'action' => 'requirements_next',
            'payload' => ['db_driver' => 'sqlite'],
        ])->assertOk()->assertJsonPath('state.step', 'database');

        $response = $this->postJson('/api/v1/installer/action', [
            'action' => 'database_test',
            'payload' => [
                'db_driver' => 'mysql',
                'mysql_host' => '127.0.0.1',
                'mysql_port' => 3306,
                'mysql_db' => 'wgw',
                'mysql_user' => 'wgw',
                'mysql_password' => 'wrong-password',
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('state.step', 'database')
            ->assertJsonPath('state.db_driver', 'mysql')
            ->assertJsonPath('state.db.mysql_host', '127.0.0.1')
            ->assertJsonPath('state.db.mysql_db', 'wgw');

        $error = (string) $response->json('error');
        $this->assertStringNotContainsString('SQL:', $error);
        $this->assertStringNotContainsString('SQLSTATE', $error);
    }

    public function test_database_test_reports_missing_pdo_mysql_extension(): void
    {
        if (extension_loaded('pdo_mysql')) {
            $this->markTestSkipped('pdo_mysql is loaded in this PHP runtime.');
        }

        $this->postJson('/api/v1/installer/action', [
            'action' => 'welcome_next',
            'payload' => [],
        ])->assertOk();

        $this->postJson('/api/v1/installer/action', [
            'action' => 'requirements_next',
            'payload' => ['db_driver' => 'sqlite'],
        ])->assertOk();

        $response = $this->postJson('/api/v1/installer/action', [
            'action' => 'database_test',
            'payload' => [
                'db_driver' => 'mysql',
                'mysql_host' => '127.0.0.1',
                'mysql_port' => 3306,
                'mysql_db' => 'wgw',
                'mysql_user' => 'wgw',
                'mysql_password' => 'secret',
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('state.db_driver', 'mysql');

        $error = (string) $response->json('error');
        $this->assertStringContainsString('pdo_mysql', $error);
    }

    public function test_install_rejects_missing_or_invalid_admin_email(): void
    {
        $this->reachAccountStep();

        $missing = $this->postJson('/api/v1/installer/action', [
            'action' => 'install',
            'payload' => $this->installPayload(['email' => '']),
        ]);
        $missing->assertOk()
            ->assertJsonPath('ok', false);
        $this->assertSame('Enter a valid email address.', $missing->json('error'));

        $invalid = $this->postJson('/api/v1/installer/action', [
            'action' => 'install',
            'payload' => $this->installPayload(['email' => 'not-an-email']),
        ]);
        $invalid->assertOk()
            ->assertJsonPath('ok', false);
        $this->assertSame('Enter a valid email address.', $invalid->json('error'));
    }

    public function test_state_and_bootstrap_expose_db_from_env_when_driver_set(): void
    {
        $this->setInstallConfig([
            'db_driver' => 'sqlite',
            'db_sqlite_path' => './wgw-content/env-flag.sqlite',
        ]);

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('state.db_from_env', true)
            ->assertJsonPath('state.db_driver', 'sqlite')
            ->assertJsonPath('state.db.sqlite_path', './wgw-content/env-flag.sqlite');

        $this->getJson('/api/v1/installer/bootstrap')
            ->assertOk()
            ->assertJsonPath('state.db_from_env', true)
            ->assertJsonPath('state.db_driver', 'sqlite');
    }

    public function test_state_exposes_db_from_env_false_without_driver(): void
    {
        $this->setInstallConfig(['db_driver' => '']);

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('state.db_from_env', false);
    }

    public function test_wizard_sqlite_install_with_database_from_env(): void
    {
        $sqlitePath = './wgw-content/env-sqlite-install.sqlite';
        $this->setInstallConfig([
            'db_driver' => 'sqlite',
            'db_sqlite_path' => $sqlitePath,
            // Partial env: database only — admin comes from the install payload.
        ]);

        $this->getJson('/api/v1/installer/bootstrap')
            ->assertOk()
            ->assertJsonPath('state.db_from_env', true);

        $this->postJson('/api/v1/installer/action', [
            'action' => 'welcome_next',
            'payload' => [],
        ])->assertOk()->assertJsonPath('state.step', 'requirements');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'requirements_next',
            'payload' => ['db_driver' => 'sqlite'],
        ])->assertOk()->assertJsonPath('state.step', 'database');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'database_next',
            'payload' => [
                'db_driver' => 'sqlite',
                'sqlite_path' => $sqlitePath,
            ],
        ])->assertOk()->assertJsonPath('state.step', 'site');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'site_next',
            'payload' => $this->sitePayload(),
        ])->assertOk()->assertJsonPath('state.step', 'account');

        $install = $this->postJson('/api/v1/installer/action', [
            'action' => 'install',
            'payload' => $this->installPayload([
                'username' => 'envadmin',
                'email' => 'envadmin@example.test',
            ]),
        ]);

        $install->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonStructure(['redirect', 'state']);

        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');
        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=sqlite', $env);
        $this->assertStringContainsString('env-sqlite-install.sqlite', $env);

        $db = new \PDO('sqlite:'.$this->installRoot.'/wgw-content/env-sqlite-install.sqlite');
        $stmt = $db->query('SELECT username FROM users');
        $this->assertSame('envadmin', $stmt->fetchColumn());
        $stmt = $db->query("SELECT email FROM principals WHERE uri = 'principals/envadmin'");
        $this->assertSame('envadmin@example.test', $stmt->fetchColumn());

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', true)
            ->assertJsonPath('state.step', 'installed');
    }

    public function test_wizard_mysql_install_with_database_from_env(): void
    {
        if (! InstallerMysqlTestDatabase::isAvailable()) {
            $this->markTestSkipped(
                'MySQL not available — run in api-mysql CI or set WGW_TEST_MYSQL_* against a local server.',
            );
        }

        $this->mysqlInstallDatabase = InstallerMysqlTestDatabase::createIsolated();
        $mysql = InstallerMysqlTestDatabase::installerPayload($this->mysqlInstallDatabase);

        $this->setInstallConfig([
            'db_driver' => 'mysql',
            'db_host' => $mysql['mysql_host'],
            'db_port' => (string) $mysql['mysql_port'],
            'db_database' => $mysql['mysql_db'],
            'db_user' => $mysql['mysql_user'],
            'db_password' => $mysql['mysql_password'],
        ]);

        $this->getJson('/api/v1/installer/bootstrap')
            ->assertOk()
            ->assertJsonPath('state.db_from_env', true)
            ->assertJsonPath('state.db_driver', 'mysql')
            ->assertJsonPath('state.db.mysql_db', $this->mysqlInstallDatabase);

        $this->postJson('/api/v1/installer/action', [
            'action' => 'welcome_next',
            'payload' => [],
        ])->assertOk()->assertJsonPath('state.step', 'requirements');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'requirements_next',
            'payload' => ['db_driver' => 'mysql'],
        ])->assertOk()->assertJsonPath('state.step', 'database');

        // Env-backed payload mirrors WGW_INSTALL_DB_* (password still required on the wire).
        $this->postJson('/api/v1/installer/action', [
            'action' => 'database_next',
            'payload' => $mysql,
        ])->assertOk()->assertJsonPath('state.step', 'site');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'site_next',
            'payload' => $this->sitePayload(),
        ])->assertOk()->assertJsonPath('state.step', 'account');

        $install = $this->postJson('/api/v1/installer/action', [
            'action' => 'install',
            'payload' => $this->installPayload([
                'username' => 'mysqlenv',
                'email' => 'mysqlenv@example.test',
            ]),
        ]);

        $install->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonStructure(['redirect', 'state']);

        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');
        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=mysql', $env);
        $this->assertStringContainsString($this->mysqlInstallDatabase, $env);

        $admin = [
            'host' => getenv('WGW_TEST_MYSQL_HOST') ?: '127.0.0.1',
            'port' => (int) (getenv('WGW_TEST_MYSQL_PORT') ?: 3306),
            'user' => getenv('WGW_TEST_MYSQL_USERNAME') ?: 'root',
            'password' => getenv('WGW_TEST_MYSQL_PASSWORD') ?: '',
        ];
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $admin['host'],
            $admin['port'],
            $this->mysqlInstallDatabase,
        );
        $db = new \PDO($dsn, $admin['user'], $admin['password'], wgw_mysql_pdo_options());
        $stmt = $db->query('SELECT username FROM users');
        $this->assertSame('mysqlenv', $stmt->fetchColumn());
        $stmt = $db->query("SELECT email FROM principals WHERE uri = 'principals/mysqlenv'");
        $this->assertSame('mysqlenv@example.test', $stmt->fetchColumn());
        $stmt = $db->query('SELECT COUNT(*) FROM users');
        $this->assertSame('1', (string) $stmt->fetchColumn());
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function installPayload(array $overrides = []): array
    {
        return array_merge([
            'username' => 'admin',
            'display_name' => 'Admin',
            'email' => 'admin@example.test',
            'password' => 'longpassword',
            'password_confirm' => 'longpassword',
            'mail_enabled' => false,
            'meet_enabled' => false,
        ], $overrides);
    }

    /**
     * @return array<string, mixed>
     */
    private function sitePayload(): array
    {
        return [
            'timezone' => 'UTC',
            'enable_files' => true,
            'enable_calendars' => true,
            'enable_contacts' => false,
            'show_browser_ui' => true,
        ];
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function setInstallConfig(array $overrides): void
    {
        config(['wgw.install' => array_merge((array) config('wgw.install', []), $overrides)]);
    }

    private function reachAccountStep(): void
    {
        $this->postJson('/api/v1/installer/action', [
            'action' => 'welcome_next',
            'payload' => [],
        ])->assertOk()->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'requirements');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'requirements_next',
            'payload' => ['db_driver' => 'sqlite'],
        ])->assertOk()->assertJsonPath('state.step', 'database');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'database_next',
            'payload' => [
                'db_driver' => 'sqlite',
                'sqlite_path' => './wgw-content/install-email-test.sqlite',
            ],
        ])->assertOk()->assertJsonPath('state.step', 'site');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'site_next',
            'payload' => $this->sitePayload(),
        ])->assertOk()->assertJsonPath('state.step', 'account');
    }
}
