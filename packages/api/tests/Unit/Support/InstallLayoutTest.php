<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\InstallLayout;
use App\Support\SafePath;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

final class InstallLayoutTest extends TestCase
{
    #[Test]
    public function monorepo_root_is_null_for_domain_install_root(): void
    {
        $this->assertNull(InstallLayout::monorepoRoot('/var/www/vhosts/xxx.com'));
    }

    #[Test]
    public function monorepo_root_is_detected_for_wegotworkspace_shell(): void
    {
        $this->assertSame(
            '/srv/sabre-installer',
            InstallLayout::monorepoRoot('/srv/sabre-installer/apps/wegotworkspace'),
        );
    }

    #[Test]
    public function path_candidates_skip_monorepo_paths_on_shared_hosting_layout(): void
    {
        $paths = InstallLayout::pathCandidates(
            '/var/www/vhosts/xxx.com',
            fn (string $root): array => [$root.'/packages/apps/install/dist'],
        );

        $this->assertSame(['/var/www/vhosts/xxx.com/packages/apps/install/dist'], $paths);
    }

    #[Test]
    public function monorepo_checkout_root_is_not_an_install_tree(): void
    {
        $this->assertTrue(InstallLayout::isMonorepoCheckoutRoot(dirname(__DIR__, 5)));
        $this->assertFalse(InstallLayout::isMonorepoCheckoutRoot('/srv/sabre-installer/apps/wegotworkspace'));
        $this->assertFalse(InstallLayout::isMonorepoCheckoutRoot('/var/www/vhosts/xxx.com'));
    }

    #[Test]
    public function path_candidates_prefer_monorepo_paths_in_dev_layout(): void
    {
        $paths = InstallLayout::pathCandidates(
            '/srv/sabre-installer/apps/wegotworkspace',
            fn (string $root): array => [$root.'/packages/apps/install/dist'],
        );

        $this->assertSame([
            '/srv/sabre-installer/packages/apps/install/dist',
            '/srv/sabre-installer/apps/wegotworkspace/packages/apps/install/dist',
        ], $paths);
    }
}

final class SafePathTest extends TestCase
{
    #[Test]
    public function is_accessible_allows_paths_when_open_basedir_is_unset(): void
    {
        $this->assertTrue(SafePath::isAccessible('/any/path/index.html'));
    }

    #[Test]
    public function is_file_returns_false_for_paths_outside_open_basedir_without_touching_them(): void
    {
        $original = ini_get('open_basedir');
        if (! is_string($original) || $original === '') {
            $this->markTestSkipped('open_basedir is not configured in this PHP runtime.');
        }

        $allowed = explode(PATH_SEPARATOR, $original)[0];
        $blocked = '/'.trim(str_replace('\\', '/', dirname($allowed)), '/').'/outside-open-basedir/index.html';

        $this->assertFalse(SafePath::isFile($blocked));
    }

    #[Test]
    public function is_html_file_rejects_null_byte_placeholders(): void
    {
        $path = sys_get_temp_dir().'/wgw-safe-path-'.uniqid('', true).'.html';
        file_put_contents($path, str_repeat("\0", 128));

        try {
            $this->assertFalse(SafePath::isHtmlFile($path));
        } finally {
            @unlink($path);
        }
    }

    #[Test]
    public function is_html_file_accepts_real_html(): void
    {
        $path = sys_get_temp_dir().'/wgw-safe-path-'.uniqid('', true).'.html';
        file_put_contents($path, '<!doctype html><html></html>');

        try {
            $this->assertTrue(SafePath::isHtmlFile($path));
        } finally {
            @unlink($path);
        }
    }
}
