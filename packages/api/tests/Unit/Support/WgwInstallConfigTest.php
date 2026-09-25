<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\WgwInstallConfig;
use PHPUnit\Framework\Attributes\Test;
use ReflectionClass;
use Tests\TestCase;

final class WgwInstallConfigTest extends TestCase
{
    #[Test]
    public function repo_root_cwd_resolves_install_root_to_apps_wegotworkspace(): void
    {
        $previousAppRoot = getenv('WGW_APP_ROOT') ?: false;
        $previousCwd = getcwd();
        $repoRoot = $this->monorepoRootFromConfigClass();
        $expected = $repoRoot.'/apps/wegotworkspace';

        putenv('WGW_APP_ROOT');
        unset($_ENV['WGW_APP_ROOT'], $_SERVER['WGW_APP_ROOT']);
        config(['wgw.install_root' => null]);

        try {
            $this->assertTrue(is_dir($repoRoot) && is_file($repoRoot.'/pnpm-workspace.yaml'));
            chdir($repoRoot);
            $installRoot = (new WgwInstallConfig)->installRoot();
            $this->assertSame($expected, $installRoot);
            $this->assertSame(
                $expected.'/wgw-content/db.sqlite',
                (new WgwInstallConfig)->resolveInstallPath('./wgw-content/db.sqlite'),
            );
        } finally {
            if (is_string($previousCwd) && $previousCwd !== '') {
                chdir($previousCwd);
            }
            if (is_string($previousAppRoot) && $previousAppRoot !== '') {
                putenv('WGW_APP_ROOT='.$previousAppRoot);
                $_ENV['WGW_APP_ROOT'] = $previousAppRoot;
                $_SERVER['WGW_APP_ROOT'] = $previousAppRoot;
            } else {
                putenv('WGW_APP_ROOT');
                unset($_ENV['WGW_APP_ROOT'], $_SERVER['WGW_APP_ROOT']);
            }
        }
    }

    #[Test]
    public function path_if_inside_install_root_accepts_confined_files_and_rejects_escapes(): void
    {
        $base = sys_get_temp_dir().'/wgw-path-confine-'.uniqid('', true);
        $installRoot = $base.'/install';
        $dataDir = $installRoot.'/data';
        $insideFile = $dataDir.'/path-confine-test.sqlite';
        $outsideFile = $base.'/outside.sqlite';
        $symlink = $dataDir.'/path-confine-symlink.sqlite';

        mkdir($dataDir, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        file_put_contents($insideFile, '');
        file_put_contents($outsideFile, '');

        $previousInstallRoot = config('wgw.install_root');
        $previousDataDir = config('wgw.data_dir');
        config([
            'wgw.install_root' => $installRoot,
            'wgw.data_dir' => $dataDir,
        ]);

        try {
            $install = new WgwInstallConfig;
            $root = $install->installRoot();
            $insideDir = rtrim($install->dataDir(), '/');
            $rootPrefix = rtrim(str_replace('\\', '/', $root), '/').'/';
            $insideNormalized = str_replace('\\', '/', $insideFile);
            $this->assertStringStartsWith($rootPrefix, $insideNormalized);
            $insideRelative = './'.substr($insideNormalized, strlen($rootPrefix));

            $this->assertSame(
                realpath($insideFile),
                $install->pathIfInsideInstallRoot($insideFile),
            );
            $this->assertSame(
                realpath($insideFile),
                $install->pathIfInsideInstallRoot($install->resolveInstallPath($insideRelative)),
            );
            $this->assertNull($install->pathIfInsideInstallRoot($outsideFile));

            // Existing file outside the root, reached via .. from a dir under the install tree.
            $escapeViaDotDot = $insideDir.'/../../'.basename($outsideFile);
            $this->assertSame(realpath($outsideFile), realpath($escapeViaDotDot));
            $this->assertNull($install->pathIfInsideInstallRoot($escapeViaDotDot));

            // Symlink under the install tree that points outside must be rejected.
            if (@symlink($outsideFile, $symlink)) {
                $this->assertNull($install->pathIfInsideInstallRoot($symlink));
            }
        } finally {
            config([
                'wgw.install_root' => $previousInstallRoot,
                'wgw.data_dir' => $previousDataDir,
            ]);
            @unlink($symlink);
            @unlink($insideFile);
            @unlink($outsideFile);
            @unlink($installRoot.'/index.php');
            @rmdir($dataDir);
            @rmdir($installRoot);
            @rmdir($base);
        }
    }

    private function monorepoRootFromConfigClass(): string
    {
        $file = (new ReflectionClass(WgwInstallConfig::class))->getFileName();
        $this->assertIsString($file);

        // WgwInstallConfig.php lives in packages/api/app/Support — five levels to repo root.
        return dirname($file, 5);
    }
}
