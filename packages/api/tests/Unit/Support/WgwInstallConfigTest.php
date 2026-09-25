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
        $install = new WgwInstallConfig;
        $root = $install->installRoot();
        $insideDir = rtrim($install->dataDir(), '/');
        if (! is_dir($insideDir)) {
            mkdir($insideDir, 0775, true);
        }

        $insideFile = $insideDir.'/path-confine-test.sqlite';
        $outsideFile = sys_get_temp_dir().'/wgw-path-confine-outside-'.uniqid('', true).'.sqlite';
        file_put_contents($insideFile, '');
        file_put_contents($outsideFile, '');

        try {
            $this->assertSame(
                realpath($insideFile),
                $install->pathIfInsideInstallRoot($insideFile),
            );
            $this->assertSame(
                realpath($insideFile),
                $install->pathIfInsideInstallRoot($install->resolveInstallPath('./wgw-content/path-confine-test.sqlite')),
            );
            $this->assertNull($install->pathIfInsideInstallRoot($outsideFile));
            $this->assertNull(
                $install->pathIfInsideInstallRoot($root.'/../path-confine-escape-'.uniqid('', true)),
            );
        } finally {
            @unlink($insideFile);
            @unlink($outsideFile);
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
