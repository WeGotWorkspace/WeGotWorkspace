<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\InstallerWindow;
use App\Services\Installer\StrayDataDirCleaner;
use App\Support\AppPaths;
use App\Support\WebRootDeny;
use App\Support\WgwInstallConfig;
use Tests\Support\UiDistFixture;
use Tests\TestCase;

final class StrayDataDirCleanerTest extends TestCase
{
    private string $root = '';

    private string $stray = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->root = sys_get_temp_dir().'/wgw-stray-data-dir-'.uniqid('', true);
        $this->stray = $this->root.'/install/wgw-content';
        mkdir($this->stray, 0775, true);
        mkdir($this->root.'/data', 0775, true);
        $this->useDataDir($this->root.'/data');
    }

    protected function tearDown(): void
    {
        UiDistFixture::removeTree($this->root);

        parent::tearDown();
    }

    public function test_removes_the_full_set_an_earlier_boot_generated(): void
    {
        $this->writeGeneratedFiles();

        $this->assertTrue($this->cleaner()->removeIfStray());
        $this->assertDirectoryDoesNotExist($this->stray);
    }

    public function test_removes_the_set_a_web_wizard_install_left_with_its_window_stamp(): void
    {
        $this->writeGeneratedFiles();
        file_put_contents($this->stray.'/'.InstallerWindow::STAMP_NAME, "1792345678\n");

        $this->assertTrue($this->cleaner()->removeIfStray());
        $this->assertDirectoryDoesNotExist($this->stray);
    }

    public function test_a_window_stamp_with_other_content_keeps_everything(): void
    {
        $this->writeGeneratedFiles();
        file_put_contents($this->stray.'/'.InstallerWindow::STAMP_NAME, "1792345678\nmore\n");

        $this->assertKeptIntact([InstallerWindow::STAMP_NAME, '.htaccess', 'keys/oauth-private.key']);
    }

    public function test_removes_a_folder_holding_only_the_oauth_pair(): void
    {
        $this->writeKeys();

        $this->assertTrue($this->cleaner()->removeIfStray());
        $this->assertDirectoryDoesNotExist($this->stray);
    }

    public function test_removes_a_folder_holding_only_the_deny_files(): void
    {
        file_put_contents($this->stray.'/.htaccess', WebRootDeny::HTACCESS);
        file_put_contents($this->stray.'/.probe', WebRootDeny::PROBE);

        $this->assertTrue($this->cleaner()->removeIfStray());
        $this->assertDirectoryDoesNotExist($this->stray);
    }

    public function test_an_extra_file_keeps_everything(): void
    {
        $this->writeGeneratedFiles();
        file_put_contents($this->stray.'/notes.txt', "mine\n");

        $this->assertKeptIntact(['.htaccess', '.probe', 'keys/oauth-private.key', 'keys/oauth-public.key', 'notes.txt']);
    }

    public function test_an_extra_file_in_keys_keeps_everything(): void
    {
        $this->writeGeneratedFiles();
        file_put_contents($this->stray.'/keys/api-jwt-private.pem', str_repeat('p', 64));

        $this->assertKeptIntact(['.htaccess', 'keys/oauth-private.key', 'keys/api-jwt-private.pem']);
    }

    public function test_install_data_keeps_everything(): void
    {
        $this->writeGeneratedFiles();
        file_put_contents($this->stray.'/.installed', "2026-10-18\n");
        file_put_contents($this->stray.'/db.sqlite', 'sqlite');
        mkdir($this->stray.'/files');

        $this->assertKeptIntact(['.installed', 'db.sqlite', 'files', 'keys/oauth-private.key']);
    }

    public function test_an_edited_htaccess_keeps_everything(): void
    {
        $this->writeKeys();
        file_put_contents($this->stray.'/.htaccess', "Require all denied\n");

        $this->assertKeptIntact(['.htaccess', 'keys/oauth-private.key']);
    }

    public function test_a_fallback_install_keeps_its_live_data_dir(): void
    {
        $this->writeGeneratedFiles();
        $this->useDataDir($this->stray);

        $this->assertKeptIntact(['.htaccess', '.probe', 'keys/oauth-private.key', 'keys/oauth-public.key']);
    }

    public function test_a_data_dir_nested_inside_the_folder_keeps_everything(): void
    {
        mkdir($this->stray.'/keys');
        $this->useDataDir($this->stray.'/keys');

        $this->assertKeptIntact(['keys']);
    }

    public function test_a_symlinked_folder_is_left_alone(): void
    {
        rmdir($this->stray);
        $target = $this->root.'/elsewhere';
        mkdir($target);
        file_put_contents($target.'/.probe', WebRootDeny::PROBE);
        symlink($target, $this->stray);

        $this->assertFalse($this->cleaner()->removeIfStray());
        $this->assertFileExists($target.'/.probe');
        $this->assertTrue(is_link($this->stray));
        unlink($this->stray);
    }

    public function test_a_missing_folder_is_a_no_op(): void
    {
        rmdir($this->stray);

        $this->assertFalse($this->cleaner()->removeIfStray());
    }

    /**
     * @param  list<string>  $paths
     */
    private function assertKeptIntact(array $paths): void
    {
        $this->assertFalse($this->cleaner()->removeIfStray());
        foreach ($paths as $path) {
            $this->assertFileExists($this->stray.'/'.$path);
        }
    }

    private function writeGeneratedFiles(): void
    {
        file_put_contents($this->stray.'/.htaccess', WebRootDeny::HTACCESS);
        file_put_contents($this->stray.'/.probe', WebRootDeny::PROBE);
        $this->writeKeys();
    }

    private function writeKeys(): void
    {
        if (! is_dir($this->stray.'/keys')) {
            mkdir($this->stray.'/keys', 0700);
        }
        // The cleaner matches names only, so placeholders stand in for the PEM files.
        file_put_contents($this->stray.'/keys/oauth-private.key', "orphaned private key\n");
        file_put_contents($this->stray.'/keys/oauth-public.key', "orphaned public key\n");
    }

    private function useDataDir(string $dataDir): void
    {
        config([
            'wgw.install_root' => $this->root.'/install',
            'wgw.data_dir' => $dataDir,
        ]);
        app()->forgetInstance(WgwInstallConfig::class);
        app()->forgetInstance(AppPaths::class);
    }

    private function cleaner(): StrayDataDirCleaner
    {
        return app(StrayDataDirCleaner::class);
    }
}
