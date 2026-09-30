<?php

declare(strict_types=1);

namespace Tests\Feature\Update;

use App\Models\AppUpdateHistory;
use App\Services\Update\UpdateStateStore;
use Tests\Support\Update\FakeHttps;
use Tests\Support\Update\PreparesUpdateSandbox;
use Tests\Support\WgwDatabaseTestCase;

final class UpdateFailureTest extends WgwDatabaseTestCase
{
    use PreparesUpdateSandbox;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootUpdateSandbox();
    }

    protected function tearDown(): void
    {
        $this->destroyUpdateSandbox();
        parent::tearDown();
    }

    public function test_network_failure_leaves_clean_state(): void
    {
        $fixture = $this->releaseFixture;
        $this->assertNotNull($fixture);
        $zip = $fixture->zip($this->releaseTree());
        $this->publishRelease('0.2.0', $zip);
        unset(FakeHttps::$bodies[self::PACKAGE_URL]);
        $this->operations()->check();

        try {
            $this->operations()->apply(['version' => '0.2.0']);
            $this->fail('Expected the package download to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Could not download release package.', $e->getMessage());
        }

        $this->assertUpdaterIdle();
        $this->assertSame([], $this->backupZips());
        $this->assertStringContainsString('old-index', (string) file_get_contents($this->installRoot.'/index.php'));
        $this->assertSame('failed', AppUpdateHistory::query()->latest('id')->value('status'));
        $state = app(UpdateStateStore::class)->read();
        $this->assertFalse($state['last_result']['ok']);
        $this->assertSame('Could not download release package.', $state['last_result']['message']);
    }

    public function test_checksum_failure_discards_partial_package(): void
    {
        $fixture = $this->releaseFixture;
        $this->assertNotNull($fixture);
        $zip = $fixture->zip($this->releaseTree());
        $checksum = hash('sha256', 'not-the-package');
        $this->publishRelease('0.2.0', $zip, $checksum, $fixture->sign($checksum));
        $this->operations()->check();

        try {
            $this->operations()->apply(['version' => '0.2.0']);
            $this->fail('Expected checksum verification to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Release checksum verification failed.', $e->getMessage());
        }

        $this->assertUpdaterIdle();
        $this->assertSame([], $this->backupZips());
        $this->assertSame("0.1.0\n", file_get_contents($this->installRoot.'/VERSION'));
    }

    public function test_signature_failure_does_not_extract(): void
    {
        $fixture = $this->releaseFixture;
        $this->assertNotNull($fixture);
        $zip = $fixture->zip($this->releaseTree());
        $this->publishRelease('0.2.0', $zip, hash('sha256', $zip), base64_encode(random_bytes(32)));
        $this->operations()->check();

        try {
            $this->operations()->apply(['version' => '0.2.0']);
            $this->fail('Expected signature verification to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Release signature verification failed.', $e->getMessage());
        }

        $this->assertUpdaterIdle();
        $this->assertDirectoryDoesNotExist($this->dataRoot.'/updates/tmp/staging');
        $this->assertSame([], $this->backupZips());
    }

    public function test_extraction_failure_preserves_existing_backup(): void
    {
        $planted = $this->plantBackup();
        $plantedHash = hash_file('sha256', $planted);
        $bytes = 'this is not a zip';
        $fixture = $this->releaseFixture;
        $this->assertNotNull($fixture);
        $checksum = hash('sha256', $bytes);
        $this->publishRelease('0.2.0', $bytes, $checksum, $fixture->sign($checksum));
        $this->operations()->check();

        try {
            $this->operations()->apply(['version' => '0.2.0']);
            $this->fail('Expected extraction to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Could not open release ZIP.', $e->getMessage());
        }

        $this->assertUpdaterIdle();
        $this->assertCount(1, $this->backupZips());
        $this->assertSame($plantedHash, hash_file('sha256', $planted));
        $this->assertSame("0.1.0\n", file_get_contents($this->installRoot.'/VERSION'));
        $state = app(UpdateStateStore::class)->read();
        $this->assertFalse($state['last_result']['ok']);
        $this->assertSame('failed', AppUpdateHistory::query()->latest('id')->value('status'));
    }

    public function test_apply_failure_after_backup_keeps_archive_and_skips_file_rollback(): void
    {
        $this->skipWhenRootIgnoresModeBits();
        $fixture = $this->releaseFixture;
        $this->assertNotNull($fixture);
        $this->publishRelease('0.2.0', $fixture->zip($this->releaseTree()));
        $this->operations()->check();

        $this->withBackupDatabase(function (\PDO $pdo): void {
            $this->seedCanary();
            $this->lockInstallRoot();
            try {
                $this->operations()->apply(['version' => '0.2.0']);
                $this->fail('Expected file apply to fail on a read-only install root.');
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('not writable', $e->getMessage());
            } finally {
                $this->unlockInstallRoot();
            }

            $this->assertHistory($pdo, 'failed', 'not writable');
            $zips = $this->backupZips();
            $this->assertCount(1, $zips);
            $this->assertBackupTakenBeforeFileSwap($zips[0], $pdo);
        });

        $this->assertUpdaterIdle();
        $this->assertStringContainsString('old-index', (string) file_get_contents($this->installRoot.'/index.php'));
        $this->assertSame("0.1.0\n", file_get_contents($this->installRoot.'/VERSION'));
        $log = $this->logText();
        $backupAt = strpos($log, 'Stage: Creating backup.');
        $replaceAt = strpos($log, 'Stage: Replacing files.');
        $this->assertIsInt($backupAt);
        $this->assertIsInt($replaceAt);
        $this->assertLessThan($replaceAt, $backupAt);
        $this->assertStringContainsString('Automatic file rollback skipped', $log);
        $this->assertStringContainsString('database-only backups', $log);
    }

    /**
     * A failure part-way through file replacement is not rolled back.
     *
     * applyPaths deletes and copies each release path in order. If a later
     * path fails, earlier paths stay on the new release. That is intentional:
     * the updater only archives the database and packages/api/.env, and that
     * archive is the recovery point.
     */
    public function test_mid_swap_failure_leaves_partial_install_and_keeps_database_backup(): void
    {
        $this->skipWhenRootIgnoresModeBits();
        $fixture = $this->releaseFixture;
        $this->assertNotNull($fixture);
        $this->publishRelease('0.2.0', $fixture->zip($this->releaseTree()));
        $this->operations()->check();

        $appsDir = $this->installRoot.'/packages/apps';
        $this->withBackupDatabase(function (\PDO $pdo) use ($appsDir): void {
            $this->seedCanary();
            $this->lockPath($appsDir);
            try {
                $this->operations()->apply(['version' => '0.2.0']);
                $this->fail('Expected a later path to fail after earlier paths were replaced.');
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('not writable', $e->getMessage());
            } finally {
                $this->unlockInstallRoot();
            }

            $this->assertHistory($pdo, 'failed', 'not writable');
            $zips = $this->backupZips();
            $this->assertCount(1, $zips);
            $this->assertBackupTakenBeforeFileSwap($zips[0], $pdo);
        });

        $this->assertUpdaterIdle();
        $this->assertStringContainsString('new-index', (string) file_get_contents($this->installRoot.'/index.php'));
        $this->assertSame("0.2.0\n", file_get_contents($this->installRoot.'/VERSION'));
        $this->assertSame("apps-old\n", file_get_contents($appsDir.'/marker.txt'));
        $this->assertStringContainsString(
            'LOCAL_MARKER=keep-me',
            (string) file_get_contents($this->installRoot.'/packages/api/.env'),
        );
        $this->assertStringContainsString('Automatic file rollback skipped', $this->logText());
        $this->assertStringContainsString('database-only backups', $this->logText());
    }

    public function test_unavailable_feed_records_error_without_partial_state(): void
    {
        try {
            $this->operations()->check();
            $this->fail('Expected an unavailable feed to fail the check.');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('No valid release metadata found', $e->getMessage());
        }

        $state = app(UpdateStateStore::class)->read();
        $this->assertArrayNotHasKey('latest', $state);
        $this->assertIsString($state['last_check_error']);
        $this->assertStringContainsString('No valid release metadata found', $state['last_check_error']);
        $this->assertUpdaterIdle();
    }

    public function test_invalid_feed_records_error(): void
    {
        FakeHttps::$bodies[self::FEED_URL] = '{not-json';

        try {
            $this->operations()->check();
            $this->fail('Expected a malformed feed to fail the check.');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('No valid release metadata found', $e->getMessage());
        }

        $state = app(UpdateStateStore::class)->read();
        $this->assertArrayNotHasKey('latest', $state);
        $this->assertStringContainsString('No valid release metadata found', (string) $state['last_check_error']);
    }

    public function test_non_https_feed_is_rejected(): void
    {
        config(['wgw.update_feed_url' => 'http://updates.test/manifest.json']);

        try {
            $this->operations()->check();
            $this->fail('Expected a non-HTTPS feed to be rejected.');
        } catch (\InvalidArgumentException $e) {
            $this->assertSame('Update feed URL must use HTTPS.', $e->getMessage());
        }

        $state = app(UpdateStateStore::class)->read();
        $this->assertArrayNotHasKey('latest', $state);
        $this->assertSame('Update feed URL must use HTTPS.', $state['last_check_error']);
    }
}
