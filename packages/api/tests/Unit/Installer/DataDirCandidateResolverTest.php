<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\DataDirCandidateResolver;
use App\Services\Installer\DataDirChoice;
use App\Support\AppPaths;
use App\Support\WgwInstallConfig;
use Tests\TestCase;

final class DataDirCandidateResolverTest extends TestCase
{
    private string $root = '';

    private string|false $previousDataDir = false;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir().'/wgw-datadir-'.uniqid('', true);
        mkdir($this->root, 0775, true);
        $previous = getenv('WGW_DATA_DIR');
        $this->previousDataDir = is_string($previous) ? $previous : false;
        $this->clearDataDirEnv();

        parent::setUp();
    }

    protected function tearDown(): void
    {
        $this->restoreDataDirEnv();
        if (is_dir($this->root)) {
            $this->removeTree($this->root);
        }

        parent::tearDown();
    }

    public function test_sibling_of_the_install_root_is_outside_the_document_root(): void
    {
        $install = $this->makeInstall($this->root.'/public');

        $choice = $this->resolve($install, $install);

        $this->assertSame($this->real($this->root.'/wgw-content'), $choice->path);
        $this->assertSame(DataDirChoice::REASON_OUTSIDE, $choice->reason);
        $this->assertFalse($choice->insidePublishedTree);
        $this->assertSame($this->real($install), trim((string) file_get_contents($choice->path.'/.wgw-owner')));
        $this->assertFileDoesNotExist($install.'/wgw-content');
    }

    public function test_candidate_inside_a_different_document_root_is_rejected(): void
    {
        $doc = $this->root.'/doc';
        $install = $this->makeInstall($doc.'/app');

        $choice = $this->resolve($install, $doc);

        $this->assertSame($this->real($this->root.'/wgw-content'), $choice->path);
        $this->assertFileDoesNotExist($doc.'/wgw-content');
    }

    public function test_symlinked_document_root_is_resolved_before_comparing(): void
    {
        $doc = $this->root.'/doc';
        $install = $this->makeInstall($doc.'/app');
        $link = $this->root.'/link';
        symlink($doc, $link);

        $choice = $this->resolve($install, $link);

        $this->assertSame($this->real($this->root.'/wgw-content'), $choice->path);
        $this->assertFileDoesNotExist($doc.'/wgw-content');
    }

    public function test_unwritable_parent_falls_back_inside_the_install(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            $this->markTestSkipped('The root user can still write a mode 0555 directory.');
        }

        $install = $this->makeInstall($this->root.'/public');
        chmod($this->root, 0555);
        try {
            $choice = $this->resolve($install, $install);
        } finally {
            chmod($this->root, 0755);
        }

        $this->assertSame(DataDirChoice::FALLBACK_PATH, $choice->path);
        $this->assertSame(DataDirChoice::REASON_FALLBACK_UNAVAILABLE, $choice->reason);
        $this->assertTrue($choice->insidePublishedTree);
        $this->assertFileDoesNotExist($this->root.'/wgw-content');
    }

    public function test_absolute_form_of_the_fallback_is_the_same_choice(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            $this->markTestSkipped('The root user can still write a mode 0555 directory.');
        }

        $install = $this->makeInstall($this->root.'/public');
        $resolver = $this->resolver($install);
        $absolute = $resolver->absolutePath(DataDirChoice::FALLBACK_PATH);
        chmod($this->root, 0555);
        try {
            $choice = $resolver->accept($absolute, $install);
        } finally {
            chmod($this->root, 0755);
        }

        $this->assertSame($this->real($install).'/wgw-content', $absolute);
        $this->assertSame(DataDirChoice::FALLBACK_PATH, $choice->path);
        $this->assertSame(DataDirChoice::REASON_FALLBACK_UNAVAILABLE, $choice->reason);
    }

    public function test_stock_env_default_is_not_treated_as_an_operator_choice(): void
    {
        $install = $this->makeInstall($this->root.'/public');
        $this->setDataDirEnv('./wgw-content');

        $choice = $this->resolve($install, $install);

        $this->assertSame(DataDirChoice::REASON_OUTSIDE, $choice->reason);
        $this->assertSame($this->real($this->root.'/wgw-content'), $choice->path);
    }

    public function test_explicit_data_dir_is_returned_unchanged(): void
    {
        $install = $this->makeInstall($this->root.'/public');
        $this->setDataDirEnv('/var/wgw/content');

        $choice = $this->resolve($install, $install);

        $this->assertSame('/var/wgw/content', $choice->path);
        $this->assertSame(DataDirChoice::REASON_ENVIRONMENT, $choice->reason);
        $this->assertFileDoesNotExist($this->root.'/wgw-content');
    }

    public function test_second_install_sharing_a_parent_gets_its_own_directory_outside(): void
    {
        $first = $this->makeInstall($this->root.'/app-a');
        $second = $this->makeInstall($this->root.'/app-b');

        $owned = $this->resolve($first, $first);
        $other = $this->resolve($second, $second);

        $this->assertSame(DataDirChoice::REASON_OUTSIDE, $owned->reason);
        $this->assertSame($this->real($this->root.'/wgw-content'), $owned->path);
        $this->assertSame(DataDirChoice::REASON_OUTSIDE, $other->reason);
        $this->assertSame($this->real($this->root.'/wgw-content-'.$this->suffix($second)), $other->path);
        $this->assertFalse($other->insidePublishedTree);
        $this->assertSame($this->real($first), trim((string) file_get_contents($owned->path.'/.wgw-owner')));
        $this->assertSame($this->real($second), trim((string) file_get_contents($other->path.'/.wgw-owner')));
        $this->assertFileDoesNotExist($second.'/wgw-content/db.sqlite');
    }

    public function test_empty_directory_is_claimed_and_a_foreign_directory_is_not(): void
    {
        $install = $this->makeInstall($this->root.'/public');
        mkdir($this->root.'/wgw-content', 0775, true);

        $empty = $this->resolve($install, $install);
        $this->assertSame(DataDirChoice::REASON_OUTSIDE, $empty->reason);

        $otherHome = $this->root.'/other';
        $otherInstall = $this->makeInstall($otherHome.'/public');
        mkdir($otherHome.'/wgw-content', 0775, true);
        file_put_contents($otherHome.'/wgw-content/db.sqlite', 'keep');

        $foreign = $this->resolve($otherInstall, $otherInstall);

        $this->assertSame(DataDirChoice::REASON_OUTSIDE, $foreign->reason);
        $this->assertSame($this->real($otherHome.'/wgw-content-'.$this->suffix($otherInstall)), $foreign->path);
        $this->assertSame('keep', (string) file_get_contents($otherHome.'/wgw-content/db.sqlite'));
    }

    public function test_fallback_when_every_outside_candidate_holds_someone_elses_data(): void
    {
        $install = $this->makeInstall($this->root.'/public');
        foreach (['wgw-content', 'wgw-content-'.$this->suffix($install)] as $name) {
            $dir = $this->root.'/'.$name;
            mkdir($dir, 0775, true);
            file_put_contents($dir.'/db.sqlite', 'keep');
        }

        $choice = $this->resolve($install, $install);

        $this->assertSame(DataDirChoice::REASON_FALLBACK_OWNED, $choice->reason);
        $this->assertSame(DataDirChoice::FALLBACK_PATH, $choice->path);
        $this->assertTrue($choice->insidePublishedTree);
        $this->assertSame('keep', (string) file_get_contents($this->root.'/wgw-content/db.sqlite'));
        $this->assertSame('keep', (string) file_get_contents($this->root.'/wgw-content-'.$this->suffix($install).'/db.sqlite'));
    }

    public function test_rerun_accepts_a_marker_for_this_install(): void
    {
        $install = $this->makeInstall($this->root.'/public');
        $dir = $this->root.'/wgw-content';
        mkdir($dir, 0775, true);
        file_put_contents($dir.'/.wgw-owner', $this->real($install)."\n");
        file_put_contents($dir.'/db.sqlite', 'already');

        $choice = $this->resolve($install, $install);

        $this->assertSame($this->real($dir), $choice->path);
        $this->assertSame('already', (string) file_get_contents($dir.'/db.sqlite'));
    }

    public function test_invalid_override_is_rejected_with_a_clear_message(): void
    {
        $install = $this->makeInstall($this->root.'/public');
        $resolver = $this->resolver($install);

        try {
            $resolver->validateOverride('wgw-content', $install);
            $this->fail('A relative override must be rejected.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Enter an absolute path for the data directory.', $e->getMessage());
        }

        try {
            $resolver->validateOverride($install.'/private-data', $install);
            $this->fail('An in-tree override must be rejected.');
        } catch (\RuntimeException $e) {
            $this->assertSame('That directory is inside the published website. Choose a folder outside it.', $e->getMessage());
        }
    }

    public function test_override_does_not_keep_an_unused_reservation(): void
    {
        $install = $this->makeInstall($this->root.'/public');
        $resolver = $this->resolver($install);
        $resolver->propose($install);

        $chosen = $resolver->accept($this->root.'/other-data', $install);

        $this->assertSame($this->real($this->root.'/other-data'), $chosen->path);
        $this->assertFileDoesNotExist($this->root.'/wgw-content');
        $this->assertSame($this->real($install), trim((string) file_get_contents($chosen->path.'/.wgw-owner')));
    }

    public function test_place_sqlite_retargets_only_the_stock_path(): void
    {
        $resolver = $this->resolver($this->makeInstall($this->root.'/public'));
        $moved = $resolver->placeSqliteDatabase(
            ['driver' => 'sqlite', 'sqlite_path' => './wgw-content/db.sqlite'],
            '/var/wgw/content',
        );
        $kept = $resolver->placeSqliteDatabase(
            ['driver' => 'sqlite', 'sqlite_path' => './wgw-content/custom.sqlite'],
            '/var/wgw/content',
        );

        $this->assertSame('/var/wgw/content/db.sqlite', $moved['sqlite_path']);
        $this->assertSame('./wgw-content/custom.sqlite', $kept['sqlite_path']);
    }

    private function resolve(string $installRoot, ?string $documentRoot): DataDirChoice
    {
        return $this->resolver($installRoot)->propose($documentRoot);
    }

    private function resolver(string $installRoot): DataDirCandidateResolver
    {
        putenv('WGW_APP_ROOT='.$installRoot);
        $_ENV['WGW_APP_ROOT'] = $installRoot;
        $_SERVER['WGW_APP_ROOT'] = $installRoot;
        config(['wgw.install_root' => $installRoot]);
        app()->forgetInstance(WgwInstallConfig::class);
        app()->forgetInstance(AppPaths::class);
        app()->forgetInstance(DataDirCandidateResolver::class);

        return app(DataDirCandidateResolver::class);
    }

    private function makeInstall(string $path): string
    {
        mkdir($path, 0775, true);
        file_put_contents($path.'/index.php', "<?php\n");

        return $path;
    }

    private function setDataDirEnv(string $value): void
    {
        putenv('WGW_DATA_DIR='.$value);
        $_ENV['WGW_DATA_DIR'] = $value;
        $_SERVER['WGW_DATA_DIR'] = $value;
    }

    private function clearDataDirEnv(): void
    {
        putenv('WGW_DATA_DIR');
        unset($_ENV['WGW_DATA_DIR'], $_SERVER['WGW_DATA_DIR']);
    }

    private function restoreDataDirEnv(): void
    {
        if (is_string($this->previousDataDir) && $this->previousDataDir !== '') {
            $this->setDataDirEnv($this->previousDataDir);

            return;
        }
        $this->clearDataDirEnv();
    }

    private function suffix(string $installRoot): string
    {
        return substr(hash('sha256', $this->real($installRoot)), 0, 8);
    }

    private function real(string $path): string
    {
        $real = realpath($path);

        return rtrim(str_replace('\\', '/', $real !== false ? $real : $path), '/');
    }

    private function removeTree(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        chmod($dir, 0755);
        $items = scandir($dir);
        if ($items === false) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            if (is_dir($path) && ! is_link($path)) {
                $this->removeTree($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}
