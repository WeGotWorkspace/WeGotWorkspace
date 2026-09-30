<?php

declare(strict_types=1);

namespace Tests\Unit\Update;

use App\Services\Update\UpdateStateService;
use App\Services\Update\UpdateStateStore;
use App\Storage\WgwStorage;
use Tests\Support\Update\TempTree;
use Tests\Support\WgwTestDisks;
use Tests\TestCase;

final class UpdateStateStoreTest extends TestCase
{
    private string $scratch = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->scratch = sys_get_temp_dir().'/wgw-state-'.uniqid('', true);
        mkdir($this->scratch.'/data', 0775, true);
        WgwTestDisks::refresh($this->scratch.'/data');
        $this->app->forgetInstance(WgwStorage::class);
        $this->app->forgetInstance(UpdateStateStore::class);
        $this->app->forgetInstance(UpdateStateService::class);
    }

    protected function tearDown(): void
    {
        if ($this->scratch !== '' && is_dir($this->scratch)) {
            TempTree::remove($this->scratch);
        }
        parent::tearDown();
    }

    public function test_state_round_trips_across_store_instances(): void
    {
        $store = app(UpdateStateStore::class);
        $store->write([
            'latest' => ['version' => '0.2.0'],
            'last_check_error' => null,
        ]);

        $again = app(UpdateStateStore::class);
        $this->assertNotSame($store, $again);
        $this->assertSame('0.2.0', $again->read()['latest']['version']);
    }

    public function test_log_cancel_and_temporary_cleanup(): void
    {
        $store = app(UpdateStateStore::class);
        $store->ensureDirs();
        $store->clearLog();
        $store->appendLog('first');
        $store->appendLog('second');
        $lines = $store->readLog();
        $this->assertCount(2, $lines);
        $this->assertStringContainsString('first', $lines[0]);
        $this->assertStringContainsString('second', $lines[1]);

        $this->assertFalse($store->isCancelRequested());
        $store->requestCancel();
        $this->assertTrue($store->isCancelRequested());
        $store->clearCancelRequest();
        $this->assertFalse($store->isCancelRequested());

        $part = $store->absolutePath($store->packageKey()).'.part';
        if (! is_dir(dirname($part))) {
            mkdir(dirname($part), 0775, true);
        }
        file_put_contents($part, 'partial');
        $this->assertFileExists($part);
        $store->cleanupTemporaryData();
        $this->assertFileDoesNotExist($part);
        $this->assertDirectoryDoesNotExist($store->absolutePath($store->tmpKey()));
    }

    public function test_backup_name_and_missing_archive_are_rejected(): void
    {
        $service = app(UpdateStateService::class);

        try {
            $service->deleteBackup('../secret.zip');
            $this->fail('Expected an invalid backup name to be rejected.');
        } catch (\InvalidArgumentException $e) {
            $this->assertSame('Invalid backup file name.', $e->getMessage());
        }

        try {
            $service->backupAbsolutePath('missing.zip');
            $this->fail('Expected a missing backup to be rejected.');
        } catch (\InvalidArgumentException $e) {
            $this->assertSame('Backup not found.', $e->getMessage());
        }
    }

    public function test_legacy_backup_directory_is_not_downloadable(): void
    {
        $store = app(UpdateStateStore::class);
        $store->ensureDirs();
        $legacy = $store->absolutePath($store->backupDir()).'/backup-old';
        mkdir($legacy, 0775, true);
        file_put_contents($legacy.'/database.sqlite', 'x');

        try {
            app(UpdateStateService::class)->backupAbsolutePath('backup-old');
            $this->fail('Expected a legacy backup folder to be rejected.');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('not directly downloadable', $e->getMessage());
        }
    }
}
