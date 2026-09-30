<?php

declare(strict_types=1);

namespace Tests\Unit\Update;

use App\Services\Update\ApiPackageLocalPreservation;
use PHPUnit\Framework\TestCase;

final class ApiPackageLocalPreservationTest extends TestCase
{
    private string $apiRoot = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->apiRoot = sys_get_temp_dir().'/wgw-preserve-'.uniqid('', true);
        mkdir($this->apiRoot, 0775, true);
    }

    protected function tearDown(): void
    {
        if ($this->apiRoot !== '' && is_dir($this->apiRoot)) {
            $this->rmTree($this->apiRoot);
        }

        parent::tearDown();
    }

    public function test_snapshot_and_restore_preserves_env(): void
    {
        file_put_contents($this->apiRoot.'/.env', "APP_KEY=secret\nSESSION_DRIVER=file\n");

        $preservation = new ApiPackageLocalPreservation;
        $snap = $preservation->snapshot($this->apiRoot);
        $this->assertArrayHasKey('.env', $snap['files']);

        file_put_contents($this->apiRoot.'/.env', "APP_KEY=replaced\n");

        $preservation->restore($this->apiRoot, $snap);

        $this->assertSame("APP_KEY=secret\nSESSION_DRIVER=file\n", file_get_contents($this->apiRoot.'/.env'));
    }

    public function test_snapshot_and_restore_preserves_session_files(): void
    {
        $sessionDir = $this->apiRoot.'/storage/framework/sessions';
        mkdir($sessionDir, 0775, true);
        file_put_contents($sessionDir.'/sess_abc', 'payload');

        $preservation = new ApiPackageLocalPreservation;
        $snap = $preservation->snapshot($this->apiRoot);
        $this->assertArrayHasKey('storage/framework/sessions', $snap['dirs']);

        $this->rmTree($sessionDir);
        mkdir($sessionDir, 0775, true);

        $preservation->restore($this->apiRoot, $snap);

        $this->assertFileExists($sessionDir.'/sess_abc');
        $this->assertSame('payload', file_get_contents($sessionDir.'/sess_abc'));
    }

    public function test_gitignore_only_directory_is_not_preserved(): void
    {
        $sessionDir = $this->apiRoot.'/storage/framework/sessions';
        mkdir($sessionDir, 0775, true);
        file_put_contents($sessionDir.'/.gitignore', "*\n");

        $snap = (new ApiPackageLocalPreservation)->snapshot($this->apiRoot);

        $this->assertArrayNotHasKey('storage/framework/sessions', $snap['dirs']);
        $this->assertNull($snap['tempBase']);
    }

    public function test_cleanup_snapshot_removes_temp_copies(): void
    {
        file_put_contents($this->apiRoot.'/.env', "APP_KEY=secret\n");

        $preservation = new ApiPackageLocalPreservation;
        $snap = $preservation->snapshot($this->apiRoot);
        $tmp = $snap['files']['.env'];
        $this->assertFileExists($tmp);

        $preservation->cleanupSnapshot($snap);

        $this->assertFileDoesNotExist($tmp);
    }

    private function rmTree(string $dir): void
    {
        $items = scandir($dir);
        if (! is_array($items)) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            if (is_dir($path)) {
                $this->rmTree($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}
