<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Contacts\AddressBookProvisioner;
use App\Services\Installer\DevContactCatalog;
use App\Services\Installer\DevContactSeeder;
use App\Services\Installer\DevInstallBootstrap;
use App\Services\Installer\DevSeedGuard;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use App\Support\AppPaths;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class DevInstallBootstrapTest extends TestCase
{
    private string $installRoot;

    protected function setUp(): void
    {
        $this->installRoot = sys_get_temp_dir().'/wgw-dev-install-test-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);
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
        putenv('WGW_APP_ROOT');
        putenv('WGW_DEV_SEED_CONTACTS_PROFILE');
        putenv('WGW_DEV_SEED_CALENDAR_PROFILE');
        unset($_ENV['WGW_APP_ROOT'], $_ENV['WGW_DEV_SEED_CONTACTS_PROFILE'], $_ENV['WGW_DEV_SEED_CALENDAR_PROFILE']);
        WgwInstallFixture::forgetInstallBindings();

        if (is_dir($this->installRoot)) {
            $this->removeTree($this->installRoot);
        }

        parent::tearDown();
    }

    public function test_ensure_creates_sqlite_install_and_is_idempotent(): void
    {
        $bootstrap = app(DevInstallBootstrap::class);

        $this->assertTrue($bootstrap->ensure('admin', 'storybook-dev'));
        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_CONNECTION=sqlite', $env);
        $this->assertFileExists($this->installRoot.'/wgw-content/db.sqlite');
        $this->assertFileExists($this->installRoot.'/wgw-content/.installed');
        $this->assertFileExists($this->installRoot.'/wgw-content/keys/api-jwt-private.pem');

        WgwInstallFixture::syncDatabaseConnection();
        $this->assertTrue(Schema::connection('wgw')->hasTable('oauth_clients'));
        $this->assertSame(1, DB::connection('wgw')->table('users')->where('username', 'admin')->count());
        $this->assertSame(1, DB::connection('wgw')->table('users')->where('username', 'member')->count());
        $member = DB::connection('wgw')->table('principals')->where('uri', 'principals/member')->first();
        $this->assertNotNull($member);
        $this->assertSame('Member', $member->displayname);
        $this->assertSame('member@localhost', $member->email);
        $this->assertSame('SabreDAV', DB::connection('wgw')->table('app_settings')->where('name', 'auth_realm')->value('value'));
        $seeded = DB::connection('wgw')->table('calendarobjects')->where('uri', 'like', 'dev-seed-%')->count();
        $this->assertGreaterThan(0, $seeded);
        $this->assertSame(
            DevContactCatalog::COMPACT_TARGET,
            DB::connection('wgw')->table('cards')->where('uri', 'like', DevContactCatalog::URI_PREFIX.'%')->count(),
        );

        $this->assertTrue(app(AppPaths::class)->isInstalled());
        $this->assertFalse($bootstrap->ensure('admin', 'storybook-dev'));
        $this->assertSame(1, DB::connection('wgw')->table('users')->where('username', 'member')->count());
        $this->assertSame(
            $seeded,
            DB::connection('wgw')->table('calendarobjects')->where('uri', 'like', 'dev-seed-%')->count(),
        );
    }

    public function test_ensure_adds_member_on_an_existing_install_and_keeps_a_changed_password(): void
    {
        $bootstrap = app(DevInstallBootstrap::class);
        $this->assertTrue($bootstrap->ensure('admin', 'storybook-dev'));

        WgwInstallFixture::syncDatabaseConnection();
        DB::connection('wgw')->table('users')->where('username', 'member')->update(['digest' => 'kept-digest']);

        $this->assertFalse($bootstrap->ensure('admin', 'storybook-dev'));
        $this->assertSame(
            'kept-digest',
            DB::connection('wgw')->table('users')->where('username', 'member')->value('digest'),
        );

        $memberId = DB::connection('wgw')->table('principals')->where('uri', 'principals/member')->value('id');
        DB::connection('wgw')->table('groupmembers')->where('member_id', $memberId)->delete();
        DB::connection('wgw')->table('principals')->where('id', $memberId)->delete();
        DB::connection('wgw')->table('users')->where('username', 'member')->delete();
        $this->assertFalse($bootstrap->ensure('admin', 'different-pass'));
        $this->assertSame(1, DB::connection('wgw')->table('users')->where('username', 'member')->count());
        $this->assertNotSame(
            'kept-digest',
            DB::connection('wgw')->table('users')->where('username', 'member')->value('digest'),
        );
    }

    public function test_contacts_profile_accepts_large_and_calendars_stay_on_full_or_compact(): void
    {
        putenv('WGW_DEV_SEED_CONTACTS_PROFILE=large');
        putenv('WGW_DEV_SEED_CALENDAR_PROFILE=large');

        $seeder = $this->recordingContactSeeder();
        $this->app->instance(DevContactSeeder::class, $seeder);

        $this->assertTrue(app(DevInstallBootstrap::class)->ensure('admin', 'storybook-dev'));
        $this->assertSame(DevContactCatalog::PROFILE_LARGE, $seeder->profile);

        WgwInstallFixture::syncDatabaseConnection();
        $this->assertGreaterThan(
            0,
            DB::connection('wgw')->table('calendarobjects')->where('uri', 'like', 'dev-seed-%')->count(),
        );
    }

    public function test_ensure_writes_sqlite_path_into_env(): void
    {
        app(DevInstallBootstrap::class)->ensure('admin', 'storybook-dev');

        $env = (string) file_get_contents($this->installRoot.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DB_DATABASE=./wgw-content/db.sqlite', $env);

        WgwInstallFixture::syncDatabaseConnection();
        $dsn = (string) DB::connection('wgw')->getConfig('database');
        $this->assertStringEndsWith('/wgw-content/db.sqlite', $dsn);
    }

    private function recordingContactSeeder(): RecordingDevContactSeeder
    {
        return new RecordingDevContactSeeder(
            app(DevContactCatalog::class),
            app(AddressBookProvisioner::class),
            app(BestEffortSearchIndexSync::class),
            app(SearchIndexerService::class),
            app(DevSeedGuard::class),
        );
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

final class RecordingDevContactSeeder extends DevContactSeeder
{
    public ?string $profile = null;

    public function seed(
        string $username,
        string $profile = DevContactCatalog::PROFILE_FULL,
        bool $force = false,
        ?int $count = null,
    ): array {
        $this->profile = $profile;

        return ['created' => 0, 'skipped' => 0, 'deleted' => 0];
    }
}
