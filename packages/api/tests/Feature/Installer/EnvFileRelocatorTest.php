<?php

declare(strict_types=1);

namespace Tests\Feature\Installer;

use App\Services\Installer\EnvFileRelocator;
use App\Support\WgwEnvLocation;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class EnvFileRelocatorTest extends TestCase
{
    private const ENV = "APP_KEY=base64:c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTI=\nWGW_DB_PASSWORD=hunter2\n";

    private string $root = '';

    private string $install = '';

    private string|false $previousDocumentRoot = false;

    protected function setUp(): void
    {
        parent::setUp();
        $documentRoot = $_SERVER['DOCUMENT_ROOT'] ?? null;
        $this->previousDocumentRoot = is_string($documentRoot) ? $documentRoot : false;
        putenv(WgwEnvLocation::OVERRIDE_KEY);
        unset($_ENV[WgwEnvLocation::OVERRIDE_KEY], $_SERVER[WgwEnvLocation::OVERRIDE_KEY]);

        $base = realpath(sys_get_temp_dir());
        $this->root = ($base !== false ? $base : sys_get_temp_dir()).'/wgw-env-relocate-'.uniqid('', true);
        $this->install = $this->root.'/public';
        mkdir($this->install.'/packages/api', 0775, true);
        mkdir($this->root.'/wgw-content', 0775, true);
        file_put_contents($this->install.'/index.php', "<?php\n");
        file_put_contents($this->apiRoot().'/.env', self::ENV);
        chmod($this->apiRoot().'/.env', 0600);
        $_SERVER['DOCUMENT_ROOT'] = $this->install;
        WgwInstallFixture::bindInstallRoot($this->install, $this->root.'/wgw-content');
        config(['wgw.install_channel' => 'zip']);
    }

    protected function tearDown(): void
    {
        if (is_string($this->previousDocumentRoot)) {
            $_SERVER['DOCUMENT_ROOT'] = $this->previousDocumentRoot;
        } else {
            unset($_SERVER['DOCUMENT_ROOT']);
        }
        putenv('WGW_APP_ROOT');
        unset($_ENV['WGW_APP_ROOT'], $_SERVER['WGW_APP_ROOT']);
        if ($this->root !== '' && is_dir($this->root)) {
            @chmod($this->apiRoot(), 0775);
            $this->removeTree($this->root);
        }

        parent::tearDown();
    }

    public function test_a_data_directory_outside_the_tree_takes_the_env_along(): void
    {
        $target = $this->root.'/wgw-content/'.EnvFileRelocator::FILE_NAME;

        $result = $this->relocator()->relocateIntoDataDir();

        $this->assertSame(['status' => EnvFileRelocator::MOVED, 'path' => $target], $result);
        $this->assertSame(self::ENV, file_get_contents($target));
        $this->assertSame(0600, fileperms($target) & 0777);
        $this->assertFileDoesNotExist($this->apiRoot().'/.env');
        $this->assertFileDoesNotExist($target.'.lock');
        $this->assertSame($target, WgwEnvLocation::relocatedForBoot($this->apiRoot()));
        $this->assertStringNotContainsString('hunter2', (string) file_get_contents(WgwEnvLocation::pointerPath($this->apiRoot())));
    }

    public function test_a_second_run_leaves_a_relocated_env_alone(): void
    {
        $this->relocator()->relocateIntoDataDir();

        $this->assertSame('already_relocated', $this->relocator()->relocateIntoDataDir()['status']);
    }

    public function test_a_data_directory_inside_the_tree_keeps_the_env_in_place(): void
    {
        mkdir($this->install.'/wgw-content', 0775, true);
        WgwInstallFixture::bindInstallRoot($this->install, $this->install.'/wgw-content');

        $this->assertKeptInPlace('data_dir_published');
    }

    public function test_docker_keeps_its_env(): void
    {
        config(['wgw.install_channel' => 'docker']);

        $this->assertKeptInPlace('docker');
    }

    public function test_a_linked_env_is_left_to_whoever_linked_it(): void
    {
        $volume = $this->root.'/config-volume.env';
        rename($this->apiRoot().'/.env', $volume);
        symlink($volume, $this->apiRoot().'/.env');

        $this->assertSame('symlink', $this->relocator()->relocateIntoDataDir()['status']);
        $this->assertTrue(is_link($this->apiRoot().'/.env'));
        $this->assertFileDoesNotExist($this->root.'/wgw-content/'.EnvFileRelocator::FILE_NAME);
    }

    public function test_an_existing_file_at_the_target_is_never_overwritten(): void
    {
        $target = $this->root.'/wgw-content/'.EnvFileRelocator::FILE_NAME;
        file_put_contents($target, "APP_KEY=other\n");

        $this->assertKeptInPlace('target_exists');
        $this->assertSame("APP_KEY=other\n", file_get_contents($target));
    }

    public function test_an_unwritable_pointer_rolls_the_copy_back(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            $this->markTestSkipped('root writes through directory permissions.');
        }
        chmod($this->apiRoot(), 0555);

        $this->assertKeptInPlace('pointer_unwritable');
        $this->assertFileDoesNotExist($this->root.'/wgw-content/'.EnvFileRelocator::FILE_NAME);
    }

    private function assertKeptInPlace(string $status): void
    {
        $result = $this->relocator()->relocateIntoDataDir();

        $this->assertSame($status, $result['status']);
        $this->assertSame($this->apiRoot().'/.env', $result['path']);
        $this->assertSame(self::ENV, file_get_contents($this->apiRoot().'/.env'));
        $this->assertFileDoesNotExist(WgwEnvLocation::pointerPath($this->apiRoot()));
        $this->assertNull(WgwEnvLocation::relocated($this->apiRoot()));
    }

    private function relocator(): EnvFileRelocator
    {
        return app(EnvFileRelocator::class);
    }

    private function apiRoot(): string
    {
        return $this->install.'/packages/api';
    }

    private function removeTree(string $path): void
    {
        if (is_file($path) || is_link($path)) {
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
