<?php

declare(strict_types=1);

namespace Tests\Feature\Update;

use App\Services\Update\PendingSchemaMigrations;
use App\Services\Update\UpdateStateStore;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Tests\Support\UiDistFixture;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;
use Tests\TestCase;

/**
 * Before the installer has run, the data directory is still the default one
 * inside the document root. Checking for pending migrations must not write
 * there (#1803).
 */
final class PendingSchemaMigrationsBeforeInstallTest extends TestCase
{
    private string $installRoot;

    private string $dataDir;

    protected function setUp(): void
    {
        parent::setUp();

        $this->installRoot = sys_get_temp_dir().'/wgw-pending-before-install-'.uniqid('', true);
        $this->dataDir = $this->installRoot.'/wgw-content';
        mkdir($this->installRoot, 0775, true);
        file_put_contents($this->installRoot.'/index.php', "<?php\n");
        WgwInstallFixture::bindInstallRoot($this->installRoot, $this->dataDir);
        WgwTestDisks::refresh($this->dataDir);
        foreach ([WgwStorage::class, StoragePaths::class, UpdateStateStore::class, PendingSchemaMigrations::class] as $abstract) {
            $this->app->forgetInstance($abstract);
        }
        WgwInstallFixture::forgetInstallBindings();

        // The default SQLite path of a fresh ZIP install: configured, not created yet.
        config(['database.connections.wgw' => [
            'driver' => 'sqlite',
            'database' => $this->dataDir.'/db.sqlite',
            'prefix' => '',
            'foreign_key_constraints' => true,
        ]]);
        DB::purge('wgw');
    }

    protected function tearDown(): void
    {
        DB::purge('wgw');
        UiDistFixture::removeTree($this->installRoot);
        parent::tearDown();
    }

    public function test_the_check_writes_nothing_before_the_install(): void
    {
        $this->assertTrue(app(PendingSchemaMigrations::class)->applyIfPending());

        $this->assertDirectoryDoesNotExist($this->dataDir);
    }

    public function test_a_request_before_the_install_leaves_no_data_directory(): void
    {
        $this->get('/api/v1/health');

        $this->assertDirectoryDoesNotExist($this->dataDir);
    }
}
