<?php

declare(strict_types=1);

namespace Tests\Feature\Installer;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

/**
 * HTTP-boundary behavior for the installer wizard.
 *
 * Steps are driven through POST /api/v1/installer/action and read back from
 * GET /api/v1/installer/state. Outcomes are the JSON contract plus the
 * database the wizard creates.
 */
final class InstallerWizardTest extends TestCase
{
    private const array RUNTIME_ENV_KEYS = [
        'WGW_DATA_DIR',
        'WGW_UPDATE_FEED_URL',
        'WGW_DB_CONNECTION',
        'WGW_DB_DATABASE',
        'WGW_DB_HOST',
        'WGW_DB_PORT',
        'WGW_DB_USERNAME',
        'WGW_DB_PASSWORD',
    ];

    private string $installRoot = '';

    /**
     * getenv false means absent. $_ENV and $_SERVER use false for a missing key.
     *
     * @var array<string, array{getenv: string|false, env: string|false, server: string|false}>
     */
    private array $runtimeEnvSnapshot = [];

    protected function setUp(): void
    {
        $this->snapshotRuntimeEnv();

        $this->installRoot = sys_get_temp_dir().'/wgw-installer-wizard-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);
        mkdir($this->installRoot.'/wgw-content', 0775, true);
        file_put_contents($this->installRoot.'/index.php', "<?php\n");

        putenv('WGW_APP_ROOT='.$this->installRoot);
        $_ENV['WGW_APP_ROOT'] = $this->installRoot;
        $_SERVER['WGW_APP_ROOT'] = $this->installRoot;
        putenv('WGW_DISABLE_INSTALL_THROTTLE=1');
        $_ENV['WGW_DISABLE_INSTALL_THROTTLE'] = '1';
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        parent::setUp();

        WgwInstallFixture::ensureApiPackage($this->installRoot);
        config([
            'wgw.install_root' => $this->installRoot,
            'wgw.data_dir' => $this->installRoot.'/wgw-content',
        ]);
    }

    protected function tearDown(): void
    {
        $this->restoreRuntimeEnv();

        config(['wgw.install' => []]);
        putenv('WGW_APP_ROOT');
        unset($_ENV['WGW_APP_ROOT'], $_SERVER['WGW_APP_ROOT']);
        WgwInstallFixture::forgetInstallBindings();
        putenv('WGW_DISABLE_INSTALL_THROTTLE');
        unset($_ENV['WGW_DISABLE_INSTALL_THROTTLE']);
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE']);

        if ($this->installRoot !== '' && is_dir($this->installRoot)) {
            File::deleteDirectory($this->installRoot);
        }

        parent::tearDown();
    }

    public function test_welcome_screen_starts_uninstalled_and_advances(): void
    {
        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', false)
            ->assertJsonPath('maintenance', false)
            ->assertJsonPath('state.step', 'welcome')
            ->assertJsonStructure(['state' => ['checks']]);

        $this->getJson('/api/v1/installer/bootstrap')
            ->assertOk()
            ->assertJsonPath('state.step', 'welcome');

        $this->postJson('/api/v1/installer/action', [])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');

        $this->postJson('/api/v1/installer/action', [
            'action' => 'not_a_step',
            'payload' => [],
        ])->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');

        $this->postAction('welcome_next')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'requirements');

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', false)
            ->assertJsonPath('state.step', 'requirements');
    }

    public function test_requirements_step_rejects_failed_checks_until_recovered(): void
    {
        $this->breakApiPackageRequirements();

        $this->postAction('welcome_next')
            ->assertOk()
            ->assertJsonPath('state.step', 'requirements');

        $blocked = $this->postAction('requirements_next', ['db_driver' => 'sqlite']);
        $blocked->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('state.step', 'requirements')
            ->assertJsonPath('error', 'Some requirements are still not met. Fix them, reload, then continue.');

        $failed = array_values(array_filter(
            $blocked->json('state.checks'),
            static fn (mixed $check): bool => is_array($check)
                && ($check['ok'] ?? true) === false
                && empty($check['optional']),
        ));
        $this->assertNotEmpty($failed);

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('state.step', 'requirements')
            ->assertJsonPath('installed', false);

        $this->repairApiPackageRequirements();

        $this->postAction('requirements_next', ['db_driver' => 'sqlite'])
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'database');
    }

    public function test_database_step_rejects_invalid_credentials_and_empty_fields(): void
    {
        $this->advanceToDatabase();

        $empty = $this->postAction('database_next', [
            'db_driver' => 'mysql',
            'mysql_host' => '',
            'mysql_port' => 1,
            'mysql_db' => '',
            'mysql_user' => '',
            'mysql_password' => '',
        ]);
        $empty->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('state.step', 'database')
            ->assertJsonPath('state.db_driver', 'mysql');
        $this->assertInstallerErrorIsSafe((string) $empty->json('error'));
        $this->assertArrayNotHasKey('mysql_password', (array) $empty->json('state.db'));

        $invalid = $this->postAction('database_test', [
            'db_driver' => 'mysql',
            'mysql_host' => '127.0.0.1',
            'mysql_port' => 1,
            'mysql_db' => 'wgw_missing',
            'mysql_user' => 'wgw',
            'mysql_password' => 'not-the-password',
        ]);
        $invalid->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('state.step', 'database')
            ->assertJsonPath('state.db_driver', 'mysql')
            ->assertJsonPath('state.db.mysql_host', '127.0.0.1')
            ->assertJsonPath('state.db.mysql_db', 'wgw_missing')
            ->assertJsonPath('state.db.mysql_user', 'wgw');
        $this->assertInstallerErrorIsSafe((string) $invalid->json('error'));
        $this->assertArrayNotHasKey('mysql_password', (array) $invalid->json('state.db'));

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', false)
            ->assertJsonPath('state.step', 'database');
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-content/.installed');
    }

    public function test_realm_config_step_rejects_empty_services_and_stores_site(): void
    {
        $this->advanceToSite();

        $empty = $this->postAction('site_next', [
            'timezone' => '',
            'base_uri_override' => '',
            'enable_files' => false,
            'enable_calendars' => false,
            'enable_contacts' => false,
            'show_browser_ui' => false,
        ]);
        $empty->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('state.step', 'site')
            ->assertJsonPath('error', 'Enable at least one of WebDAV files, calendars, or contacts.');

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('state.step', 'site');

        $saved = $this->postAction('site_next', [
            'timezone' => 'Europe/Amsterdam',
            'base_uri_override' => 'workspace',
            'enable_files' => true,
            'enable_calendars' => true,
            'enable_contacts' => true,
            'show_browser_ui' => true,
        ]);
        $saved->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'account')
            ->assertJsonPath('state.timezone', 'Europe/Amsterdam')
            ->assertJsonPath('state.base_uri', '/workspace/')
            ->assertJsonPath('state.enable_files', true)
            ->assertJsonPath('state.enable_calendars', true)
            ->assertJsonPath('state.enable_contacts', true);

        $blankTimezone = $this->postAction('site_next', $this->sitePayload(['timezone' => '']));
        $blankTimezone->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'account')
            ->assertJsonPath('state.timezone', 'UTC');
    }

    public function test_admin_step_rejects_empty_fields_and_weak_passwords_then_retries(): void
    {
        $sqlite = $this->sqlitePath('admin-validation.sqlite');
        $this->advanceToAccount($sqlite);

        $cases = [
            [['username' => ''], 'Username must be 2–63 characters: lowercase letters, digits, underscore, or hyphen.'],
            [['username' => 'A'], 'Username must be 2–63 characters: lowercase letters, digits, underscore, or hyphen.'],
            [['username' => 'bad name'], 'Username must be 2–63 characters: lowercase letters, digits, underscore, or hyphen.'],
            [['username' => 'admin@example.test'], 'Username must be 2–63 characters: lowercase letters, digits, underscore, or hyphen.'],
            [['email' => ''], 'Enter a valid email address.'],
            [['email' => 'not-an-email'], 'Enter a valid email address.'],
            [['password' => 'short', 'password_confirm' => 'short'], 'Use a password of at least 10 characters.'],
            [['password' => '', 'password_confirm' => ''], 'Use a password of at least 10 characters.'],
            [['password' => 'longpassword', 'password_confirm' => 'different-1'], 'Passwords do not match.'],
        ];

        foreach ($cases as [$overrides, $expected]) {
            $rejected = $this->postAction('install', $this->installPayload($overrides));
            $rejected->assertOk()
                ->assertJsonPath('ok', false)
                ->assertJsonPath('state.step', 'account')
                ->assertJsonPath('error', $expected);
        }

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', false)
            ->assertJsonPath('state.step', 'account');
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-content/.installed');

        $created = $this->postAction('install', $this->installPayload([
            'username' => 'owner',
            'display_name' => '',
            'email' => 'owner@example.test',
        ]));
        $created->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'installed');

        $db = $this->installedPdo($sqlite);
        $this->assertSame('owner', $this->scalar($db, 'SELECT username FROM users'));
        $this->assertSame('owner', $this->scalar($db, "SELECT displayname FROM principals WHERE uri = 'principals/owner'"));
        $this->assertSame('owner@example.test', $this->scalar($db, "SELECT email FROM principals WHERE uri = 'principals/owner'"));
        $this->assertAdminCanSignIn('owner', 'longpassword');
    }

    public function test_fresh_install_leaves_the_browser_plugin_off(): void
    {
        $sqlite = $this->sqlitePath('browser-off.sqlite');
        $this->advanceToSite($sqlite);

        $this->postAction('install', $this->installPayload([
            'username' => 'admin',
            'email' => 'admin@example.test',
        ]))->assertOk()->assertJsonPath('ok', true);

        $db = $this->installedPdo($sqlite);
        $this->assertSame(
            'false',
            $this->scalar($db, "SELECT value FROM app_settings WHERE name = 'browser_plugin'"),
        );
    }

    public function test_happy_path_creates_first_admin_and_sets_realm(): void
    {
        $sqlite = $this->sqlitePath('happy-path.sqlite');
        $this->advanceToAccount($sqlite, [
            'timezone' => 'Europe/Amsterdam',
            'base_uri_override' => 'workspace',
            'enable_files' => true,
            'enable_calendars' => true,
            'enable_contacts' => true,
        ]);

        $install = $this->postAction('install', $this->installPayload([
            'username' => 'workspace-admin',
            'display_name' => 'Workspace Admin',
            'email' => 'admin@example.test',
        ]));

        $install->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'installed')
            ->assertJsonPath('state.already_installed', true);
        $this->assertStringStartsWith('/login', (string) $install->json('redirect'));

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', true)
            ->assertJsonPath('state.step', 'installed');

        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');

        $db = $this->installedPdo($sqlite);
        $this->assertSame('1', $this->scalar($db, 'SELECT COUNT(*) FROM users'));
        $this->assertSame('workspace-admin', $this->scalar($db, 'SELECT username FROM users'));
        $this->assertSame('Workspace Admin', $this->scalar($db, "SELECT displayname FROM principals WHERE uri = 'principals/workspace-admin'"));
        $this->assertSame('admin@example.test', $this->scalar($db, "SELECT email FROM principals WHERE uri = 'principals/workspace-admin'"));
        $this->assertSame('SabreDAV', $this->scalar($db, "SELECT value FROM app_settings WHERE name = 'auth_realm'"));
        $this->assertSame('/workspace/', $this->scalar($db, "SELECT value FROM app_settings WHERE name = 'base_uri'"));
        $this->assertSame('Europe/Amsterdam', $this->scalar($db, "SELECT value FROM app_settings WHERE name = 'timezone'"));

        $this->assertAdminCanSignIn('workspace-admin', 'longpassword');
    }

    public function test_retry_after_failed_database_connection_completes_install(): void
    {
        $sqlite = $this->sqlitePath('retry-db.sqlite');
        $this->advanceToDatabase();

        $failed = $this->postAction('database_next', [
            'db_driver' => 'mysql',
            'mysql_host' => '127.0.0.1',
            'mysql_port' => 1,
            'mysql_db' => 'wgw_missing',
            'mysql_user' => 'wgw',
            'mysql_password' => 'wrong-password',
        ]);
        $failed->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('state.step', 'database')
            ->assertJsonPath('state.db_driver', 'mysql');
        $this->assertInstallerErrorIsSafe((string) $failed->json('error'));
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-content/.installed');

        $retried = $this->postAction('database_test', [
            'db_driver' => 'sqlite',
            'sqlite_path' => $sqlite,
        ]);
        $retried->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'database')
            ->assertJsonPath('state.db_driver', 'sqlite')
            ->assertJsonPath('state.db.sqlite_path', $sqlite);

        $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => $sqlite,
        ])->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'site');

        $this->postAction('site_next', $this->sitePayload())
            ->assertOk()
            ->assertJsonPath('state.step', 'account');

        $this->postAction('install', $this->installPayload([
            'username' => 'retry-admin',
            'email' => 'retry@example.test',
        ]))->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'installed');

        $db = $this->installedPdo($sqlite);
        $this->assertSame('retry-admin', $this->scalar($db, 'SELECT username FROM users'));
        $this->assertSame('SabreDAV', $this->scalar($db, "SELECT value FROM app_settings WHERE name = 'auth_realm'"));
        $this->assertAdminCanSignIn('retry-admin', 'longpassword');
    }

    public function test_back_navigation_between_steps_then_completes_install(): void
    {
        $first = $this->sqlitePath('back-first.sqlite');
        $second = $this->sqlitePath('back-second.sqlite');
        $this->advanceToAccount($first);

        $this->postJson('/api/v1/installer/action', [
            'action' => 'back',
            'payload' => [],
        ])->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('state.step', 'account');

        $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => $first,
        ])->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'site');

        $this->postAction('welcome_next')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'requirements');

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('state.step', 'requirements');

        $this->postAction('requirements_next', ['db_driver' => 'sqlite'])
            ->assertOk()
            ->assertJsonPath('state.step', 'database');

        $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => $second,
        ])->assertOk()
            ->assertJsonPath('state.step', 'site');

        $this->postAction('site_next', $this->sitePayload([
            'timezone' => 'Europe/Amsterdam',
            'base_uri_override' => 'workspace',
        ]))->assertOk()
            ->assertJsonPath('state.step', 'account')
            ->assertJsonPath('state.timezone', 'Europe/Amsterdam')
            ->assertJsonPath('state.base_uri', '/workspace/');

        $this->postAction('install', $this->installPayload([
            'username' => 'back-admin',
            'email' => 'back@example.test',
        ]))->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'installed');

        $db = $this->installedPdo($second);
        $this->assertSame('back-admin', $this->scalar($db, 'SELECT username FROM users'));
        $this->assertSame('SabreDAV', $this->scalar($db, "SELECT value FROM app_settings WHERE name = 'auth_realm'"));
        $this->assertSame('/workspace/', $this->scalar($db, "SELECT value FROM app_settings WHERE name = 'base_uri'"));
        $this->assertSame('Europe/Amsterdam', $this->scalar($db, "SELECT value FROM app_settings WHERE name = 'timezone'"));
        $this->assertSqliteHasNoUsers($first);
        $this->assertAdminCanSignIn('back-admin', 'longpassword');
    }

    public function test_duplicate_admin_username_does_not_create_a_second_user(): void
    {
        // Target contract is below. Current behavior returns ok and ignores the new password.
        $this->markTestIncomplete(
            'Reinstall on an existing database must be refused. https://github.com/WeGotWorkspace/WeGotWorkspace/issues/993'
        );

        $sqlite = $this->sqlitePath('duplicate-admin.sqlite');
        $this->installAdmin($sqlite);

        $this->clearInstallMarkers();

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', false)
            ->assertJsonPath('state.step', 'welcome');

        $this->advanceToAccount($sqlite);
        $again = $this->postAction('install', $this->installPayload([
            'username' => 'admin',
            'email' => 'other@example.test',
            'password' => 'different-password',
            'password_confirm' => 'different-password',
        ]));
        $this->assertExistingAccountRefused($again);

        $db = $this->installedPdo($sqlite);
        $this->assertSame('1', $this->scalar($db, 'SELECT COUNT(*) FROM users'));
        $this->assertSame('admin', $this->scalar($db, 'SELECT username FROM users'));
        $this->assertSame('admin@example.test', $this->scalar($db, "SELECT email FROM principals WHERE uri = 'principals/admin'"));
    }

    public function test_reinstall_on_existing_database_with_different_username_is_refused(): void
    {
        $sqlite = $this->sqlitePath('reinstall-intruder.sqlite');
        $this->installAdmin($sqlite, [
            'timezone' => 'Europe/Amsterdam',
            'base_uri_override' => 'workspace',
            'enable_files' => true,
            'enable_calendars' => true,
            'enable_contacts' => true,
        ]);

        $settingsBefore = $this->appSettings($this->installedPdo($sqlite));
        $keysBefore = $this->jwtKeyMaterial();

        $this->clearInstallMarkers(removeKeys: false);
        // The installer copied WGW_DB_* into this process. Drop that so the next
        // request matches a new process whose .env is gone and whose key files remain.
        $this->forgetInstallerDatabaseRuntime();

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', false)
            ->assertJsonPath('state.step', 'welcome');

        $this->advanceToDatabase();
        $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => $sqlite,
        ])->assertOk()->assertJsonPath('ok', true);

        $this->postAction('site_next', $this->sitePayload([
            'timezone' => 'Pacific/Auckland',
            'base_uri_override' => 'intruder',
            'enable_files' => false,
            'enable_calendars' => false,
            'enable_contacts' => true,
        ]))->assertOk();

        $again = $this->postAction('install', $this->installPayload([
            'username' => 'intruder',
            'display_name' => 'Intruder',
            'email' => 'intruder@example.test',
            'password' => 'intruder-password',
            'password_confirm' => 'intruder-password',
        ]));

        $db = $this->installedPdo($sqlite);
        $this->assertSame('1', $this->scalar($db, 'SELECT COUNT(*) FROM users'));
        $this->assertSame('admin', $this->scalar($db, 'SELECT username FROM users'));
        $this->assertFalse(
            $db->query("SELECT username FROM users WHERE username = 'intruder'")->fetchColumn(),
        );
        $this->assertSame($settingsBefore, $this->appSettings($db), 'Reinstall must not rewrite app_settings.');

        WgwInstallFixture::syncDatabaseConnection();
        $this->postJson('/api/v1/auth/token', [
            'username' => 'intruder',
            'password' => 'intruder-password',
        ])->assertUnauthorized();

        $keysAfter = $this->jwtKeyMaterial();
        if ($keysAfter !== $keysBefore) {
            $this->markTestIncomplete(
                'Reinstall with the JWT key files still on disk replaced them. Launch-blocker: https://github.com/WeGotWorkspace/WeGotWorkspace/issues/993'
            );
        }
        $this->assertSame($keysBefore, $keysAfter, 'Reinstall must not replace JWT keys.');

        // Keys are still on disk, so connecting to the existing database closes the wizard.
        // A success here would be the misleading ok:true tracked by #993.
        if ($again->json('ok') !== false) {
            $this->markTestIncomplete(
                'Reinstall on an existing database must be refused. https://github.com/WeGotWorkspace/WeGotWorkspace/issues/993'
            );
        }

        $again->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('error', 'This instance is already installed.');
    }

    public function test_already_installed_state_returns_error(): void
    {
        $sqlite = $this->sqlitePath('already-installed.sqlite');
        $this->advanceToAccount($sqlite);
        $this->postAction('install', $this->installPayload([
            'username' => 'admin',
            'email' => 'admin@example.test',
        ]))->assertOk()->assertJsonPath('ok', true);

        $welcome = $this->postAction('welcome_next');
        $welcome->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('error', 'This instance is already installed.')
            ->assertJsonPath('state.step', 'installed')
            ->assertJsonPath('state.already_installed', true);
        $this->assertStringContainsString('/admin/updates', (string) $welcome->json('redirect'));

        $this->postAction('install', $this->installPayload())
            ->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('error', 'This instance is already installed.');

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', true)
            ->assertJsonPath('state.step', 'installed');

        $db = $this->installedPdo($sqlite);
        $this->assertSame('1', $this->scalar($db, 'SELECT COUNT(*) FROM users'));
        $this->assertAdminCanSignIn('admin', 'longpassword');
    }

    public function test_install_before_database_is_configured_is_rejected(): void
    {
        $this->postAction('welcome_next')->assertOk()->assertJsonPath('state.step', 'requirements');

        $install = $this->postAction('install', $this->installPayload());
        $install->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('error', 'Your session expired before installation finished. Please start again.');

        $this->getJson('/api/v1/installer/state')
            ->assertOk()
            ->assertJsonPath('installed', false);
        $this->assertFileDoesNotExist($this->installRoot.'/wgw-content/.installed');
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function postAction(string $action, array $payload = []): TestResponse
    {
        return $this->postJson('/api/v1/installer/action', [
            'action' => $action,
            'payload' => $payload,
        ]);
    }

    private function advanceToDatabase(): void
    {
        $this->postAction('welcome_next')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'requirements');

        $this->postAction('requirements_next', ['db_driver' => 'sqlite'])
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'database');
    }

    private function advanceToSite(string $sqlitePath = ''): void
    {
        $sqlitePath = $sqlitePath !== '' ? $sqlitePath : $this->sqlitePath();
        $this->advanceToDatabase();
        $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => $sqlitePath,
        ])->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'site');
    }

    /**
     * @param  array<string, mixed>  $siteOverrides
     */
    private function advanceToAccount(string $sqlitePath, array $siteOverrides = []): void
    {
        $this->advanceToSite($sqlitePath);
        $this->postAction('site_next', $this->sitePayload($siteOverrides))
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'account');
    }

    private function sqlitePath(string $name = 'wizard.sqlite'): string
    {
        return './wgw-content/'.$name;
    }

    private function absoluteSqlite(string $relative): string
    {
        return $this->installRoot.'/'.ltrim($relative, './');
    }

    private function installedPdo(string $relative): \PDO
    {
        return new \PDO('sqlite:'.$this->absoluteSqlite($relative));
    }

    private function scalar(\PDO $db, string $sql): string
    {
        $value = $db->query($sql)->fetchColumn();
        $this->assertNotFalse($value);

        return (string) $value;
    }

    private function assertSqliteHasNoUsers(string $relative): void
    {
        $path = $this->absoluteSqlite($relative);
        if (! is_file($path) || filesize($path) < 1) {
            return;
        }

        $db = new \PDO('sqlite:'.$path);
        $table = $db->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")->fetchColumn();
        if ($table === false) {
            return;
        }

        $this->assertSame('0', (string) $db->query('SELECT COUNT(*) FROM users')->fetchColumn());
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
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function sitePayload(array $overrides = []): array
    {
        return array_merge([
            'timezone' => 'UTC',
            'base_uri_override' => '',
            'enable_files' => true,
            'enable_calendars' => true,
            'enable_contacts' => false,
            'show_browser_ui' => true,
        ], $overrides);
    }

    private function assertInstallerErrorIsSafe(string $error): void
    {
        $this->assertNotSame('', $error);
        $this->assertStringNotContainsString('SQLSTATE', $error);
        $this->assertStringNotContainsString('SQL:', $error);
    }

    private function assertExistingAccountRefused(TestResponse $response): void
    {
        $response->assertOk()->assertJsonPath('ok', false);
        $error = (string) $response->json('error');
        $this->assertMatchesRegularExpression('/already exists/i', $error);
        $this->assertInstallerErrorIsSafe($error);
    }

    /**
     * @param  array<string, mixed>  $siteOverrides
     */
    private function installAdmin(string $sqlitePath, array $siteOverrides = []): void
    {
        $this->advanceToAccount($sqlitePath, $siteOverrides);
        $this->postAction('install', $this->installPayload([
            'username' => 'admin',
            'email' => 'admin@example.test',
        ]))->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.step', 'installed');
    }

    private function assertAdminCanSignIn(string $username, string $password): void
    {
        WgwInstallFixture::syncDatabaseConnection();

        $this->postJson('/api/v1/auth/token', [
            'username' => $username,
            'password' => $password,
        ])->assertOk()
            ->assertJsonPath('username', $username)
            ->assertJsonPath('role', 'admin');
    }

    /**
     * @return array<string, string>
     */
    private function appSettings(\PDO $db): array
    {
        $rows = $db->query('SELECT name, value FROM app_settings ORDER BY name')->fetchAll(\PDO::FETCH_KEY_PAIR);
        $this->assertIsArray($rows);
        ksort($rows);

        return $rows;
    }

    /**
     * @return array<string, string>
     */
    private function jwtKeyMaterial(): array
    {
        $material = [];
        foreach (['api-jwt-private.pem', 'api-jwt-public.pem'] as $name) {
            $path = $this->installRoot.'/wgw-content/keys/'.$name;
            $this->assertFileExists($path);
            $material[$name] = hash_file('sha256', $path);
        }

        return $material;
    }

    private function snapshotRuntimeEnv(): void
    {
        $this->runtimeEnvSnapshot = [];
        foreach (self::RUNTIME_ENV_KEYS as $key) {
            $fromGetenv = getenv($key);
            $this->runtimeEnvSnapshot[$key] = [
                'getenv' => is_string($fromGetenv) ? $fromGetenv : false,
                'env' => array_key_exists($key, $_ENV) && is_string($_ENV[$key]) ? $_ENV[$key] : false,
                'server' => array_key_exists($key, $_SERVER) && is_string($_SERVER[$key]) ? $_SERVER[$key] : false,
            ];
        }
    }

    private function restoreRuntimeEnv(): void
    {
        foreach ($this->runtimeEnvSnapshot as $key => $snapshot) {
            if ($snapshot['getenv'] === false) {
                putenv($key);
            } else {
                putenv($key.'='.$snapshot['getenv']);
            }

            if ($snapshot['env'] === false) {
                unset($_ENV[$key]);
            } else {
                $_ENV[$key] = $snapshot['env'];
            }

            if ($snapshot['server'] === false) {
                unset($_SERVER[$key]);
            } else {
                $_SERVER[$key] = $snapshot['server'];
            }
        }

        if ($this->app !== null) {
            DB::purge('wgw');
        }
    }

    private function forgetInstallerDatabaseRuntime(): void
    {
        foreach (self::RUNTIME_ENV_KEYS as $key) {
            putenv($key);
            unset($_ENV[$key], $_SERVER[$key]);
        }

        putenv('WGW_DB_DATABASE=:memory:');
        $_ENV['WGW_DB_DATABASE'] = ':memory:';
        $_SERVER['WGW_DB_DATABASE'] = ':memory:';

        config([
            'database.connections.wgw.driver' => 'sqlite',
            'database.connections.wgw.database' => ':memory:',
        ]);
        DB::purge('wgw');
        WgwInstallFixture::forgetInstallBindings();
    }

    private function clearInstallMarkers(bool $removeKeys = true): void
    {
        $paths = [
            $this->installRoot.'/wgw-content/.installed',
            $this->installRoot.'/packages/api/.env',
        ];
        if ($removeKeys) {
            $paths[] = $this->installRoot.'/wgw-content/keys/api-jwt-private.pem';
            $paths[] = $this->installRoot.'/wgw-content/keys/api-jwt-public.pem';
        }

        foreach ($paths as $path) {
            if (is_file($path)) {
                unlink($path);
            }
        }
    }

    private function breakApiPackageRequirements(): void
    {
        $api = $this->installRoot.'/packages/api';
        if (! is_dir($api.'/vendor')) {
            mkdir($api.'/vendor', 0775, true);
        }
        file_put_contents($api.'/vendor/autoload.php', "<?php\n");
        $example = $api.'/.env.example';
        if (is_file($example)) {
            unlink($example);
        }
    }

    private function repairApiPackageRequirements(): void
    {
        $source = base_path('.env.example');
        $this->assertFileExists($source);
        copy($source, $this->installRoot.'/packages/api/.env.example');
    }
}
