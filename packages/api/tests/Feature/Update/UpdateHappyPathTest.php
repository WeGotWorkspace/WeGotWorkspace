<?php

declare(strict_types=1);

namespace Tests\Feature\Update;

use App\Services\Update\UpdateStateService;
use Tests\Support\Update\PreparesUpdateSandbox;
use Tests\Support\WgwDatabaseTestCase;

final class UpdateHappyPathTest extends WgwDatabaseTestCase
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

    public function test_full_update_cycle_succeeds(): void
    {
        $fixture = $this->releaseFixture;
        $this->assertNotNull($fixture);
        $this->publishRelease('0.2.0', $fixture->zip($this->releaseTree()));

        $ops = $this->operations();
        $checked = $ops->check();
        $this->assertTrue($checked['updateAvailable']);
        $this->assertSame('0.1.0', $checked['installedVersion']);
        $this->assertSame('0.2.0', $checked['latest']['version']);
        $this->assertSame(self::PACKAGE_URL, $checked['latest']['package_url']);
        $this->assertFalse($checked['inProgress']);

        $this->withBackupDatabase(function (\PDO $pdo) use ($ops): void {
            $this->seedCanary();
            $result = $ops->apply(['version' => '0.2.0']);

            $this->assertTrue($result['ok']);
            $this->assertSame('0.2.0', $result['version']);
            $this->assertSame('Update applied successfully.', $result['message']);
            $this->assertIsString($result['finishedAt']);
            $this->assertHistory($pdo, 'success', 'Update applied successfully.');

            $zips = $this->backupZips();
            $this->assertCount(1, $zips);
            $this->assertBackupTakenBeforeFileSwap($zips[0], $pdo);

            $state = $this->app->make(UpdateStateService::class)->snapshot();
            $this->assertFalse($state['inProgress']);
            $this->assertNull($state['phase']);
            $this->assertSame('0.2.0', $state['installedVersion']);
            $this->assertFalse($state['updateAvailable']);
            $this->assertTrue($state['lastResult']['ok']);
            $this->assertCount(1, $state['backups']);
            $this->assertTrue($state['backups'][0]['downloadable']);
            $this->assertSame('0.1.0', $state['backups'][0]['fromVersion']);
            $this->assertSame('0.2.0', $state['backups'][0]['toVersion']);
        });

        $this->assertSame("0.2.0\n", file_get_contents($this->installRoot.'/VERSION'));
        $this->assertStringContainsString('new-index', (string) file_get_contents($this->installRoot.'/index.php'));
        $this->assertSame("apps-new\n", file_get_contents($this->installRoot.'/packages/apps/marker.txt'));
        $this->assertStringContainsString(
            'LOCAL_MARKER=keep-me',
            (string) file_get_contents($this->installRoot.'/packages/api/.env'),
        );
        $this->assertSame(
            "log-before\n",
            file_get_contents($this->installRoot.'/packages/api/storage/logs/laravel.log'),
        );
        $this->assertUpdaterIdle();

        $log = $this->logText();
        $backupAt = strpos($log, 'Stage: Creating backup.');
        $replaceAt = strpos($log, 'Stage: Replacing files.');
        $this->assertIsInt($backupAt);
        $this->assertIsInt($replaceAt);
        $this->assertLessThan($replaceAt, $backupAt);
        $this->assertStringContainsString('Update finished successfully.', $log);
    }
}
