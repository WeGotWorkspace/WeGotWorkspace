<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\WebRootDeny;
use PHPUnit\Framework\TestCase;

final class WebRootDenyTest extends TestCase
{
    private string $dataDir = '';

    /** @var list<string> */
    private array $tempRoots = [];

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && is_dir($this->dataDir)) {
            $this->removeTree($this->dataDir);
        }
        foreach ($this->tempRoots as $root) {
            if (is_dir($root)) {
                $this->removeTree($root);
            }
        }

        parent::tearDown();
    }

    public function test_data_dir_provisioning_writes_a_deny_htaccess_and_probe(): void
    {
        $this->dataDir = sys_get_temp_dir().'/wgw-web-root-deny-'.uniqid('', true);
        mkdir($this->dataDir, 0775, true);

        WebRootDeny::ensure($this->dataDir);

        $htaccess = (string) file_get_contents($this->dataDir.'/.htaccess');
        $this->assertStringContainsString('Require all denied', $htaccess);
        $this->assertSame(WebRootDeny::PROBE, (string) file_get_contents($this->dataDir.'/.probe'));

        file_put_contents($this->dataDir.'/.htaccess', "leave-me\n");
        WebRootDeny::ensure($this->dataDir);
        $this->assertSame("leave-me\n", (string) file_get_contents($this->dataDir.'/.htaccess'));
    }

    public function test_ensure_all_writes_deny_files_and_leaves_existing_htaccess(): void
    {
        $root = $this->tempRoot();
        $dataDir = $root.'/wgw-content';
        mkdir($dataDir, 0775, true);
        mkdir($root.'/packages', 0775, true);
        mkdir($root.'/wgw-plugins', 0775, true);

        WebRootDeny::ensureAll($root, $dataDir);

        foreach ([$dataDir, $root.'/packages', $root.'/wgw-plugins'] as $dir) {
            $htaccess = (string) file_get_contents($dir.'/.htaccess');
            $this->assertStringContainsString('Require all denied', $htaccess);
            $this->assertSame(WebRootDeny::PROBE, (string) file_get_contents($dir.'/.probe'));
        }

        file_put_contents($root.'/packages/.htaccess', "leave-me\n");
        WebRootDeny::ensureAll($root, $dataDir);
        $this->assertSame("leave-me\n", (string) file_get_contents($root.'/packages/.htaccess'));
        $this->assertSame(WebRootDeny::PROBE, (string) file_get_contents($root.'/packages/.probe'));

        $partial = $this->tempRoot();
        $onlyData = $partial.'/wgw-content';
        mkdir($onlyData, 0775, true);
        WebRootDeny::ensureAll($partial, $onlyData);
        $this->assertFileDoesNotExist($partial.'/packages');
        $this->assertFileDoesNotExist($partial.'/wgw-plugins');
        $this->assertFileExists($onlyData.'/.htaccess');
    }

    public function test_ensure_root_rules_inserts_once_replaces_old_block_and_keeps_admin_lines(): void
    {
        $root = $this->tempRoot();
        $path = $root.'/.htaccess';
        file_put_contents($path, "Options -Indexes -MultiViews\n# admin-custom\nphp_value memory_limit 256M\n");

        $this->assertTrue(WebRootDeny::ensureRootRules($root));
        $once = (string) file_get_contents($path);
        $this->assertSame(1, substr_count($once, '# BEGIN wgw-deny'));
        $this->assertSame(1, substr_count($once, '# END wgw-deny'));
        $this->assertStringContainsString($this->managedDenyBlock(), $once);
        $this->assertSame(1, substr_count($once, '# BEGIN wgw-headers'));
        $this->assertSame(1, substr_count($once, '# END wgw-headers'));
        $this->assertStringContainsString(WebRootDeny::managedHeadersBlock(), $once);
        $this->assertStringStartsWith("Options -Indexes -MultiViews\n# BEGIN wgw-headers\n", $once);
        $this->assertStringContainsString("# admin-custom\nphp_value memory_limit 256M\n", $once);

        $this->assertTrue(WebRootDeny::ensureRootRules($root));
        $this->assertSame($once, (string) file_get_contents($path));

        $old = str_replace(
            'RedirectMatch 404 ^/(?:wgw-content|wgw-plugins|packages)(?:/|$)',
            'RedirectMatch 404 ^/legacy-tree(?:/|$)',
            $once,
        );
        $this->assertNotSame($once, $old);
        file_put_contents($path, $old);

        $this->assertTrue(WebRootDeny::ensureRootRules($root));
        $replaced = (string) file_get_contents($path);
        $this->assertSame($once, $replaced);
        $this->assertStringNotContainsString('legacy-tree', $replaced);
        $this->assertStringContainsString("# admin-custom\nphp_value memory_limit 256M\n", $replaced);
    }

    public function test_ensure_root_rules_drops_legacy_unanchored_lines_and_keeps_admin_edits(): void
    {
        $root = $this->tempRoot();
        $path = $root.'/.htaccess';
        $legacyTree = 'RedirectMatch 404 ^/(?:wgw-content|wgw-private|wgw-modules|packages)(?:/|$)';
        $legacyDot = 'RedirectMatch 404 /\.(?:git|svn|hg|env|htaccess|htpasswd|user\.ini)(?:[/.]|$)';
        $custom = '# admin-custom-keep';
        file_put_contents(
            $path,
            "Options -Indexes -MultiViews\n".$legacyTree."\n".$legacyDot."\n".$custom."\n",
        );

        $this->assertTrue(WebRootDeny::ensureRootRules($root));
        $contents = (string) file_get_contents($path);

        $this->assertStringNotContainsString($legacyTree, $contents);
        $this->assertStringNotContainsString($legacyDot, $contents);
        $this->assertSame(1, substr_count($contents, '# BEGIN wgw-deny'));
        $this->assertSame(1, substr_count($contents, '# END wgw-deny'));
        $this->assertStringContainsString($this->managedDenyBlock(), $contents);
        $this->assertSame(1, substr_count($contents, $custom));
        $this->assertStringContainsString($custom."\n", $contents);
    }

    public function test_ensure_root_rules_inserts_at_the_top_when_options_is_missing(): void
    {
        $root = $this->tempRoot();
        $path = $root.'/.htaccess';
        file_put_contents($path, "# admin-custom\nRewriteBase /site\n");

        $this->assertTrue(WebRootDeny::ensureRootRules($root));
        $contents = (string) file_get_contents($path);
        $this->assertStringStartsWith("# BEGIN wgw-headers\n", $contents);
        $this->assertStringContainsString(WebRootDeny::managedHeadersBlock(), $contents);
        $this->assertStringEndsWith("# admin-custom\nRewriteBase /site\n", $contents);
    }

    public function test_ensure_root_rules_replaces_legacy_report_only_module(): void
    {
        $root = $this->tempRoot();
        $path = $root.'/.htaccess';
        $legacy = <<<'HTACCESS'
Options -Indexes -MultiViews

# Apache serves static files without PHP.
# Report-only until enforcement.
<IfModule mod_headers.c>
    <IfModule mod_setenvif.c>
        SetEnvIf X-Forwarded-Proto "^https$" WGW_HTTPS=on
    </IfModule>
    Header always set Content-Security-Policy-Report-Only "default-src 'self'"
</IfModule>

<IfModule mod_headers.c>
    Header always set X-Admin-Keep "1"
</IfModule>

# admin-custom
RewriteBase /
HTACCESS;
        file_put_contents($path, $legacy);

        $this->assertTrue(WebRootDeny::ensureRootRules($root));
        $contents = (string) file_get_contents($path);

        $this->assertSame(1, substr_count($contents, '# BEGIN wgw-headers'));
        $this->assertStringContainsString(WebRootDeny::managedHeadersBlock(), $contents);
        $this->assertStringNotContainsString('Content-Security-Policy-Report-Only', $contents);
        $this->assertStringNotContainsString('Report-only until enforcement', $contents);
        $this->assertStringContainsString('Request::isSecure() reads it', $contents);
        $this->assertStringContainsString('Header always set X-Admin-Keep "1"', $contents);
        $this->assertStringContainsString("# admin-custom\nRewriteBase /", $contents);
        $this->assertStringContainsString("# END wgw-headers\n", $contents);

        $this->assertTrue(WebRootDeny::ensureRootRules($root));
        $this->assertSame($contents, (string) file_get_contents($path));
    }

    public function test_ensure_root_rules_returns_false_on_a_read_only_file(): void
    {
        $root = $this->tempRoot();
        $path = $root.'/.htaccess';
        $original = "Options -Indexes\n# keep-admin\n";
        file_put_contents($path, $original);
        chmod($path, 0444);
        clearstatcache(true, $path);

        try {
            $this->assertFalse(WebRootDeny::ensureRootRules($root));
            $this->assertSame($original, (string) file_get_contents($path));
        } finally {
            chmod($path, 0644);
        }
    }

    private function tempRoot(): string
    {
        $root = sys_get_temp_dir().'/wgw-web-root-deny-'.uniqid('', true);
        mkdir($root, 0775, true);
        $this->tempRoots[] = $root;

        return $root;
    }

    private function managedDenyBlock(): string
    {
        return <<<'BLOCK'
# BEGIN wgw-deny
RedirectMatch 404 ^/(?:wgw-content|wgw-plugins|packages)(?:/|$)
RedirectMatch 404 ^/\.(?:git|svn|hg|env|htaccess|htpasswd|user\.ini)(?:[/.]|$)
# END wgw-deny
BLOCK;
    }

    private function removeTree(string $dir): void
    {
        $items = scandir($dir);
        if ($items === false) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            if (is_dir($path)) {
                $this->removeTree($path);
            } else {
                unlink($path);
            }
        }
        rmdir($dir);
    }
}
