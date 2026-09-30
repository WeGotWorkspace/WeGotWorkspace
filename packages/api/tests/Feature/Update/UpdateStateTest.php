<?php

declare(strict_types=1);

namespace Tests\Feature\Update;

use App\Services\Update\UpdateStateService;
use App\Services\Update\UpdateStateStore;
use Tests\Support\Update\PreparesUpdateSandbox;
use Tests\Support\WgwDatabaseTestCase;

final class UpdateStateTest extends WgwDatabaseTestCase
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

    public function test_state_tracking_survives_process_restart(): void
    {
        $store = app(UpdateStateStore::class);
        $store->write([
            'latest' => $this->latestMetadata(),
            'phase' => 'extracting',
            'current' => ['from' => '0.1.0', 'to' => '0.2.0', 'at' => date('c')],
            'phase_progress' => [
                'completed' => 1,
                'total' => 4,
                'percent' => 25,
                'updatedAt' => date('c'),
            ],
            'last_result' => ['ok' => false, 'message' => 'still running'],
        ]);
        $planted = $this->plantBackup();

        $reread = app(UpdateStateStore::class);
        $this->assertNotSame($store, $reread);
        $this->assertSame('0.2.0', $reread->read()['latest']['version']);

        file_put_contents($store->absolutePath($store->lockPath()), 'crashed');
        $this->app->forgetInstance(UpdateStateService::class);

        $snapshot = app(UpdateStateService::class)->snapshot();
        $this->assertFalse($snapshot['inProgress']);
        $this->assertNull($snapshot['phase']);
        $this->assertSame('0.2.0', $snapshot['latest']['version']);
        $this->assertSame('still running', $snapshot['lastResult']['message']);
        $this->assertFileDoesNotExist($store->absolutePath($store->lockPath()));
        $this->assertSame(basename($planted), $snapshot['backups'][0]['name']);
    }

    public function test_stale_progress_without_a_lock_is_cleared_and_recent_progress_remains(): void
    {
        $store = app(UpdateStateStore::class);
        $store->write([
            'phase' => 'downloading',
            'current' => ['from' => '0.1.0', 'to' => '0.2.0', 'at' => date('c')],
            'download' => [
                'downloadedBytes' => 1,
                'totalBytes' => 10,
                'percent' => 10,
                'updatedAt' => date('c'),
            ],
            'latest' => $this->latestMetadata(),
        ]);

        $fresh = app(UpdateStateService::class)->snapshot();
        $this->assertTrue($fresh['inProgress']);
        $this->assertSame('downloading', $fresh['phase']);
        $this->assertSame('0.2.0', $fresh['latest']['version']);

        $old = date('c', time() - 600);
        $store->write([
            'phase' => 'downloading',
            'current' => ['from' => '0.1.0', 'to' => '0.2.0', 'at' => $old],
            'download' => [
                'downloadedBytes' => 1,
                'totalBytes' => 10,
                'percent' => 10,
                'updatedAt' => $old,
            ],
            'latest' => $this->latestMetadata(),
        ]);

        $stale = app(UpdateStateService::class)->snapshot();
        $this->assertFalse($stale['inProgress']);
        $this->assertNull($stale['phase']);
        $this->assertSame('0.2.0', $stale['latest']['version']);
    }

    public function test_delete_backup_removes_archive(): void
    {
        $planted = $this->plantBackup();
        $snapshot = app(UpdateStateService::class)->deleteBackup(basename($planted));

        $this->assertFileDoesNotExist($planted);
        $this->assertSame([], $snapshot['backups']);
    }

    /**
     * @return array<string, string>
     */
    private function latestMetadata(): array
    {
        return [
            'version' => '0.2.0',
            'package_url' => self::PACKAGE_URL,
            'checksum_sha256' => str_repeat('ab', 32),
            'checksum_signature' => base64_encode('sig'),
        ];
    }
}
