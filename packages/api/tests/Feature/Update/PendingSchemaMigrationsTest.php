<?php

declare(strict_types=1);

namespace Tests\Feature\Update;

use App\Services\Installer\WgwSchemaMigrator;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Update\PendingSchemaMigrations;
use App\Services\Update\SchemaMigrationLock;
use App\Services\Update\UpdateStateStore;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use Tests\Support\AuthTestKeys;
use Tests\Support\InteractsWithWgwBearerTokens;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;
use Tests\TestCase;

/**
 * An older release's updater swaps the files, then fails to run the new
 * migrations in its own process. The first request on the new code finishes
 * them (#1076).
 */
final class PendingSchemaMigrationsTest extends TestCase
{
    use InteractsWithWgwBearerTokens;

    /** The table Calendar/get reads first, created after 0.1.70. */
    private const CALENDAR_MIGRATION = '2026_08_25_000280_wgw_create_calendar_share_dismissals';

    /** The table FileNode/get reads first, created after 0.1.70. */
    private const DRIVE_MIGRATION = '2026_08_13_000220_wgw_create_jmap_file_nodes';

    private string $installRoot;

    private string $dataDir;

    protected function setUp(): void
    {
        parent::setUp();
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->installRoot = sys_get_temp_dir().'/wgw-pending-schema-'.uniqid('', true);
        $this->dataDir = $this->installRoot.'/wgw-content';
        mkdir($this->dataDir, 0775, true);
        file_put_contents($this->installRoot.'/index.php', "<?php\n");
        WgwInstallFixture::bindInstallRoot($this->installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($this->installRoot, $this->dataDir, 'admin');
        config(['wgw.install_root' => $this->installRoot]);
        WgwTestDisks::refresh($this->dataDir);
        foreach ([WgwStorage::class, StoragePaths::class, UpdateStateStore::class, PendingSchemaMigrations::class] as $abstract) {
            $this->app->forgetInstance($abstract);
        }
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::syncDatabaseConnection();

        $keys = AuthTestKeys::rsaPair();
        config([
            'wgw.jwt.private_key' => $keys['private_key'],
            'wgw.jwt.public_key' => $keys['public_key'],
            'wgw.jwt.issuer' => $keys['issuer'],
            'wgw.jwt.audience' => $keys['audience'],
            'wgw.jwt.kid' => $keys['kid'],
        ]);
    }

    protected function tearDown(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE']);
        DB::purge('wgw');
        $this->removeTree($this->installRoot);
        parent::tearDown();
    }

    public function test_first_request_finishes_migrations_an_update_left_pending(): void
    {
        $this->rollBackToPartialUpdate();

        $calendars = $this->jmap([JmapCapabilities::CALENDARS], ['Calendar/get', ['accountId' => 'admin', 'ids' => null], 'c0']);
        $this->assertSame('Calendar/get', $calendars->json('methodResponses.0.0'), (string) $calendars->getContent());

        $files = $this->jmap([JmapCapabilities::FILENODE], ['FileNode/get', ['accountId' => 'admin', 'ids' => null], 'c0']);
        $this->assertSame('FileNode/get', $files->json('methodResponses.0.0'), (string) $files->getContent());

        $this->assertTrue(Schema::connection('wgw')->hasTable('calendar_share_dismissals'));
        $this->assertTrue(Schema::connection('wgw')->hasTable('jmap_file_nodes'));
        $this->assertSame([], app(WgwSchemaMigrator::class)->pendingMigrations());
        $this->assertSame(WgwSchemaMigrator::CURRENT_SCHEMA_VERSION, app(WgwSchemaMigrator::class)->currentVersion());
        $this->assertStringContainsString(
            'Pending database migrations finished.',
            (string) file_get_contents($this->dataDir.'/updates/process.log'),
        );
    }

    public function test_waits_while_an_updater_process_holds_the_update_lock(): void
    {
        $this->rollBackToPartialUpdate();
        mkdir($this->dataDir.'/updates', 0775, true);
        $lock = fopen($this->dataDir.'/updates/update.lock', 'c+');
        $this->assertIsResource($lock);
        $this->assertTrue(flock($lock, LOCK_EX | LOCK_NB));

        try {
            $this->assertTrue(app(PendingSchemaMigrations::class)->applyIfPending());
            $this->assertFalse(Schema::connection('wgw')->hasTable('calendar_share_dismissals'));
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }

        // The lock file stays behind when an updater is killed. Nobody holds it now.
        app(PendingSchemaMigrations::class)->applyIfPending();
        $this->assertTrue(Schema::connection('wgw')->hasTable('calendar_share_dismissals'));
    }

    public function test_a_request_waits_for_the_lock_and_is_then_served(): void
    {
        $token = $this->issueBearerTokenFor('admin');
        $this->rollBackToPartialUpdate();
        $marker = $this->dataDir.'/updates/schema-migrations.json';
        @unlink($marker);

        // Another process holds the lock for about 300 ms, as a short
        // migration run would.
        $holder = $this->holdLockInAnotherProcess(300_000);
        try {
            $started = microtime(true);
            $calendars = $this->postCalendarGet($token);
            $waited = microtime(true) - $started;
        } finally {
            proc_close($holder);
        }

        $calendars->assertOk();
        $this->assertSame('Calendar/get', $calendars->json('methodResponses.0.0'), (string) $calendars->getContent());
        $this->assertGreaterThanOrEqual(0.2, $waited, 'The request waited for the lock.');
        $this->assertSame([], app(WgwSchemaMigrator::class)->pendingMigrations());
        $this->assertSame('current', json_decode((string) file_get_contents($marker), true)['status']);
    }

    public function test_a_request_gets_503_when_the_lock_outlasts_the_wait(): void
    {
        $this->app->when(PendingSchemaMigrations::class)->needs('$lockWaitSeconds')->give(0.2);
        $token = $this->issueBearerTokenFor('admin');
        $this->rollBackToPartialUpdate();
        $marker = $this->dataDir.'/updates/schema-migrations.json';
        @unlink($marker);
        $lock = fopen($this->dataDir.'/'.SchemaMigrationLock::PATH, 'c');
        $this->assertIsResource($lock);
        $this->assertTrue(flock($lock, LOCK_EX | LOCK_NB));

        try {
            $started = microtime(true);
            $busy = $this->postCalendarGet($token);
            $this->assertGreaterThanOrEqual(0.2, microtime(true) - $started, 'The request waited before giving up.');
            $busy->assertStatus(503);
            $busy->assertHeader('Retry-After', '1');
            $this->assertFalse(Schema::connection('wgw')->hasTable('calendar_share_dismissals'));
            $this->assertFileDoesNotExist($marker);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }

        $calendars = $this->postCalendarGet($token)->assertOk();
        $this->assertSame('Calendar/get', $calendars->json('methodResponses.0.0'), (string) $calendars->getContent());
        $this->assertSame([], app(WgwSchemaMigrator::class)->pendingMigrations());
        $this->assertSame('current', json_decode((string) file_get_contents($marker), true)['status']);
    }

    public function test_the_marker_reads_failed_while_the_migrations_run(): void
    {
        $this->rollBackToPartialUpdate();
        $marker = $this->dataDir.'/updates/schema-migrations.json';
        $duringRun = [];
        DB::connection('wgw')->listen(function ($query) use ($marker, &$duringRun): void {
            if (str_starts_with(strtolower($query->sql), 'create table')) {
                $duringRun[] = json_decode((string) @file_get_contents($marker), true)['status'] ?? null;
            }
        });

        $this->assertTrue(app(PendingSchemaMigrations::class)->applyIfPending());

        // A process killed at this point leaves `failed`, so the next
        // request backs off instead of retrying straight away.
        $this->assertNotSame([], $duringRun);
        $this->assertSame(['failed'], array_values(array_unique($duringRun)));
        $this->assertSame('current', json_decode((string) file_get_contents($marker), true)['status']);
    }

    public function test_a_failed_run_is_recorded_and_the_request_continues(): void
    {
        $this->rollBackToPartialUpdate();
        DB::connection('wgw')->listen(function ($query): void {
            if (str_starts_with(strtolower($query->sql), 'create table')) {
                throw new \RuntimeException('Simulated migration failure.');
            }
        });

        $this->assertTrue(app(PendingSchemaMigrations::class)->applyIfPending());

        $marker = json_decode((string) file_get_contents($this->dataDir.'/updates/schema-migrations.json'), true);
        $this->assertSame('failed', $marker['status']);
        $this->assertIsInt($marker['failedAt']);
        $this->assertStringContainsString(
            'Pending database migrations failed: Simulated migration failure.',
            (string) file_get_contents($this->dataDir.'/updates/process.log'),
        );
    }

    public function test_a_recent_failure_is_not_retried_on_every_request(): void
    {
        $this->rollBackToPartialUpdate();
        $signature = app(WgwSchemaMigrator::class)->migrationSetSignature();
        $marker = $this->dataDir.'/updates/schema-migrations.json';
        mkdir(dirname($marker), 0775, true);

        file_put_contents($marker, json_encode(['signature' => $signature, 'status' => 'failed', 'failedAt' => time()]));
        app(PendingSchemaMigrations::class)->applyIfPending();
        $this->assertFalse(Schema::connection('wgw')->hasTable('calendar_share_dismissals'));

        $old = time() - PendingSchemaMigrations::RETRY_AFTER_SECONDS - 1;
        file_put_contents($marker, json_encode(['signature' => $signature, 'status' => 'failed', 'failedAt' => $old]));
        app(PendingSchemaMigrations::class)->applyIfPending();
        $this->assertTrue(Schema::connection('wgw')->hasTable('calendar_share_dismissals'));
        $this->assertSame('current', json_decode((string) file_get_contents($marker), true)['status']);
    }

    /**
     * Drop two tables and their migration rows, as if the update stopped
     * before those migrations ran.
     */
    private function rollBackToPartialUpdate(): void
    {
        $db = DB::connection('wgw');
        foreach ([
            self::CALENDAR_MIGRATION => 'calendar_share_dismissals',
            self::DRIVE_MIGRATION => 'jmap_file_nodes',
        ] as $migration => $table) {
            Schema::connection('wgw')->drop($table);
            $db->table('migrations')->where('migration', $migration)->delete();
        }
        $this->assertSame(
            [self::DRIVE_MIGRATION, self::CALENDAR_MIGRATION],
            app(WgwSchemaMigrator::class)->pendingMigrations(),
        );
    }

    /**
     * Starts a PHP process that takes the schema lock, holds it for
     * $microseconds and exits. Returns once the lock is held.
     *
     * @return resource
     */
    private function holdLockInAnotherProcess(int $microseconds)
    {
        $path = $this->dataDir.'/'.SchemaMigrationLock::PATH;
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0775, true);
        }
        $code = '$h = fopen($argv[1], "c"); flock($h, LOCK_EX); echo "locked\\n"; usleep((int) $argv[2]); flock($h, LOCK_UN);';
        $process = proc_open(
            [PHP_BINARY, '-r', $code, $path, (string) $microseconds],
            [1 => ['pipe', 'w']],
            $pipes,
        );
        $this->assertIsResource($process);
        $this->assertSame("locked\n", fgets($pipes[1]));

        return $process;
    }

    private function postCalendarGet(string $token): TestResponse
    {
        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [['Calendar/get', ['accountId' => 'admin', 'ids' => null], 'c0']],
        ]);
    }

    /**
     * @param  list<string>  $capabilities
     * @param  array{0: string, 1: array<string, mixed>, 2: string}  $call
     */
    private function jmap(array $capabilities, array $call): TestResponse
    {
        $token = $this->issueBearerTokenFor('admin');

        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, ...$capabilities],
            'methodCalls' => [$call],
        ])->assertOk();
    }

    private function removeTree(string $path): void
    {
        if (! is_dir($path)) {
            @unlink($path);

            return;
        }
        foreach (scandir($path) ?: [] as $item) {
            if ($item !== '.' && $item !== '..') {
                $this->removeTree($path.'/'.$item);
            }
        }
        @rmdir($path);
    }
}
