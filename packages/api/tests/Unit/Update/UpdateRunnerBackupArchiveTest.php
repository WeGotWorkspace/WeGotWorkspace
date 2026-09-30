<?php

declare(strict_types=1);

namespace Tests\Unit\Update;

use App\Services\Update\UpdateRunnerBackupArchive;
use App\Services\Update\UpdateStateStore;
use App\Storage\WgwStorage;
use Tests\Support\Update\TempTree;
use Tests\Support\WgwTestDisks;
use Tests\TestCase;

final class UpdateRunnerBackupArchiveTest extends TestCase
{
    private string $scratch = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->scratch = sys_get_temp_dir().'/wgw-backup-'.uniqid('', true);
        mkdir($this->scratch.'/data', 0775, true);
        WgwTestDisks::refresh($this->scratch.'/data');
        $this->app->forgetInstance(WgwStorage::class);
        $this->app->forgetInstance(UpdateStateStore::class);
    }

    protected function tearDown(): void
    {
        if ($this->scratch !== '' && is_dir($this->scratch)) {
            TempTree::remove($this->scratch);
        }
        parent::tearDown();
    }

    public function test_finalize_writes_metadata_and_removes_source_directory(): void
    {
        $store = app(UpdateStateStore::class);
        $store->ensureDirs();
        $archive = app(UpdateRunnerBackupArchive::class);
        $base = $archive->buildBackupBaseName('v1.2.3', 'v2.0.0/evil');
        $this->assertMatchesRegularExpression('/^backup-\d{14}-from-v1\.2\.3-to-v2\.0\.0_evil$/', $base);
        $this->assertStringContainsString('-from-unknown-to-unknown', $archive->buildBackupBaseName('   ', ''));

        $source = $store->absolutePath($store->backupDir()).'/'.$base;
        mkdir($source, 0775, true);
        file_put_contents($source.'/database.sqlite', 'db-bytes');
        $zipPath = $source.'.zip';

        $archive->finalizeBackupArchive($source, $zipPath, '1.2.3', '2.0.0');

        $this->assertDirectoryDoesNotExist($source);
        $this->assertFileExists($zipPath);
        $rows = $archive->listBackups();
        $this->assertCount(1, $rows);
        $this->assertSame('zip', $rows[0]['format']);
        $this->assertTrue($rows[0]['downloadable']);
        $this->assertSame('1.2.3', $rows[0]['fromVersion']);
        $this->assertSame('2.0.0', $rows[0]['toVersion']);
        $this->assertGreaterThan(0, $rows[0]['sizeBytes']);
    }

    public function test_list_backups_includes_legacy_directories_and_skips_other_files(): void
    {
        $store = app(UpdateStateStore::class);
        $store->ensureDirs();
        $dir = $store->absolutePath($store->backupDir());
        file_put_contents($dir.'/notes.txt', 'ignore');
        $legacy = $dir.'/backup-20200101120000-from-0.1.0-to-0.2.0';
        mkdir($legacy, 0775, true);
        file_put_contents($legacy.'/database.sqlite', 'abc');

        $rows = app(UpdateRunnerBackupArchive::class)->listBackups();

        $this->assertCount(1, $rows);
        $this->assertSame('legacy_dir', $rows[0]['format']);
        $this->assertFalse($rows[0]['downloadable']);
        $this->assertSame('0.1.0', $rows[0]['fromVersion']);
        $this->assertSame('0.2.0', $rows[0]['toVersion']);
        $this->assertSame(3, $rows[0]['sizeBytes']);
    }

    public function test_archive_creation_failure_keeps_the_source_directory(): void
    {
        $store = app(UpdateStateStore::class);
        $store->ensureDirs();
        $source = $store->absolutePath($store->backupDir()).'/pending';
        mkdir($source, 0775, true);
        file_put_contents($source.'/database.sqlite', 'keep');
        $blocked = $store->absolutePath($store->backupDir()).'/blocked.zip';
        mkdir($blocked, 0775, true);

        try {
            app(UpdateRunnerBackupArchive::class)->finalizeBackupArchive($source, $blocked, '0.1.0', '0.2.0');
            $this->fail('Expected backup ZIP creation to fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Could not create backup ZIP archive.', $e->getMessage());
        }

        $this->assertDirectoryExists($source);
        $this->assertFileExists($source.'/database.sqlite');
    }
}
