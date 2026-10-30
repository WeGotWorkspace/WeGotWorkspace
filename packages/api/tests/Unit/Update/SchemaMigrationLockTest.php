<?php

declare(strict_types=1);

namespace Tests\Unit\Update;

use App\Services\Update\SchemaMigrationLock;
use App\Services\Update\UpdateStateStore;
use App\Storage\WgwStorage;
use Tests\Support\Update\TempTree;
use Tests\Support\WgwTestDisks;
use Tests\TestCase;

final class SchemaMigrationLockTest extends TestCase
{
    private string $scratch = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->scratch = sys_get_temp_dir().'/wgw-schema-lock-'.uniqid('', true);
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

    public function test_the_updater_skips_its_migrations_while_a_request_runs_them(): void
    {
        $lock = app(SchemaMigrationLock::class);
        $held = $lock->tryAcquire();
        $this->assertIsResource($held);
        $this->assertNull($lock->tryAcquire());

        $ran = false;
        $this->assertFalse($lock->runExclusive(function () use (&$ran): void {
            $ran = true;
        }, 0));
        $this->assertFalse($ran);

        $lock->release($held);
        $this->assertTrue($lock->runExclusive(function () use (&$ran): void {
            $ran = true;
        }, 0));
        $this->assertTrue($ran);
    }

    public function test_the_lock_is_released_when_the_work_throws(): void
    {
        $lock = app(SchemaMigrationLock::class);

        try {
            $lock->runExclusive(static function (): void {
                throw new \RuntimeException('migration failed');
            }, 0);
            $this->fail('Expected the work to throw.');
        } catch (\RuntimeException $e) {
            $this->assertSame('migration failed', $e->getMessage());
        }

        $held = $lock->tryAcquire();
        $this->assertIsResource($held);
        $lock->release($held);
    }
}
