<?php

declare(strict_types=1);

namespace Tests\Unit\Security;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class WebRootRedirectMatchTest extends TestCase
{
    #[DataProvider('htaccessFiles')]
    public function test_redirect_match_allows_dav_paths_and_denies_sensitive_files(string $filename): void
    {
        $patterns = $this->redirectPatterns($filename);

        foreach ($this->allowedPaths() as $path) {
            $this->assertFalse(
                $this->matchesAny($patterns, $path),
                $filename.' must allow '.$path,
            );
        }

        foreach ($this->deniedPaths() as $path) {
            $this->assertTrue(
                $this->matchesAny($patterns, $path),
                $filename.' must deny '.$path,
            );
        }
    }

    #[DataProvider('htaccessFiles')]
    public function test_dav_discovery_rewrite_runs_before_the_front_controller(string $filename): void
    {
        $path = dirname(__DIR__, 5).'/apps/wegotworkspace/'.$filename;
        $htaccess = (string) file_get_contents($path);
        $base = strpos($htaccess, 'RewriteBase /');
        $front = strpos($htaccess, 'RewriteRule . index.php [L]');
        $matched = preg_match(
            '/RewriteRule\s+\^\\\\\.well-known\/\(caldav\|carddav\)\$\s+index\.php\s+\[L\]/',
            $htaccess,
            $rule,
            PREG_OFFSET_CAPTURE,
        );

        $this->assertSame(1, $matched, $filename.' is missing the discovery rewrite to index.php');
        $this->assertNotFalse($base, $filename.' is missing RewriteBase');
        $this->assertNotFalse($front, $filename.' is missing the index.php fallback');
        $offset = $rule[0][1];
        $this->assertGreaterThan($base, $offset, 'discovery rewrite must follow RewriteBase');
        $this->assertLessThan($front, $offset, 'discovery rewrite must run before the front controller');
    }

    #[DataProvider('htaccessFiles')]
    public function test_rewrite_rule_names_plugins_and_content(string $filename): void
    {
        $path = dirname(__DIR__, 5).'/apps/wegotworkspace/'.$filename;
        $htaccess = (string) file_get_contents($path);

        $this->assertStringContainsString(
            'RewriteRule ^(?:wgw-plugins|wgw-content)(?:/|$) - [F,L,NC]',
            $htaccess,
        );
    }

    public function test_shipped_htaccess_wraps_redirect_matches_in_the_managed_block(): void
    {
        $path = dirname(__DIR__, 5).'/apps/wegotworkspace/.htaccess';
        $htaccess = (string) file_get_contents($path);

        $this->assertStringContainsString($this->managedDenyBlock(), $htaccess);
    }

    public function test_install_nginx_snippet_denies_plugins_packages_dotfiles_and_config_backups(): void
    {
        $install = (string) file_get_contents(dirname(__DIR__, 5).'/INSTALL.md');

        $this->assertStringContainsString(
            'location ~ ^/(wgw-content|wgw-plugins|packages)(/|$) { deny all; }',
            $install,
        );
        $this->assertStringContainsString(
            'location ~ ^/\.(?:git|svn|hg|env|htaccess|htpasswd|user\.ini)(?:[/.]|$) { deny all; }',
            $install,
        );
        // Same pattern as the RedirectMatch rule in the wgw-deny block.
        $this->assertStringContainsString(
            'location ~ ^/wgw-config\.php\.bak(?:\.|$) { deny all; }',
            $install,
        );
    }

    /**
     * @return list<array{0: string}>
     */
    public static function htaccessFiles(): array
    {
        return [
            ['.htaccess'],
            ['example.htaccess'],
        ];
    }

    /**
     * @return list<string>
     */
    private function allowedPaths(): array
    {
        return [
            '/files/users/alice/.attachments/fn-x/a.png',
            '/files/users/alice/.notes/Journal/a.md',
            '/files/users/alice/.Trash/x.txt',
            '/files/users/alice/._photo.jpg',
            '/.well-known/oauth-authorization-server/mcp',
            '/.well-known/caldav',
            '/.well-known/carddav',
            '/sub/.env',
            '/dav/files/u/.env',
            '/files/users/alice/wgw-config.php.bak.notes',
        ];
    }

    /**
     * @return list<string>
     */
    private function deniedPaths(): array
    {
        return [
            '/.env',
            '/.env.local',
            '/.git/config',
            '/.user.ini',
            '/.htaccess',
            '/wgw-content/x',
            '/packages/api/.env',
            '/wgw-plugins/x.php',
            '/wgw-config.php.bak.20260709-120000',
            '/wgw-config.php.bak',
        ];
    }

    /**
     * @return list<string>
     */
    private function redirectPatterns(string $filename): array
    {
        $path = dirname(__DIR__, 5).'/apps/wegotworkspace/'.$filename;
        $htaccess = (string) file_get_contents($path);
        preg_match_all('/^RedirectMatch\s+404\s+(\S+)\s*$/m', $htaccess, $matches);

        return $matches[1];
    }

    /**
     * @param  list<string>  $patterns
     */
    private function matchesAny(array $patterns, string $urlPath): bool
    {
        foreach ($patterns as $pattern) {
            if (preg_match('#'.$pattern.'#', $urlPath) === 1) {
                return true;
            }
        }

        return false;
    }

    private function managedDenyBlock(): string
    {
        return <<<'BLOCK'
# BEGIN wgw-deny
RedirectMatch 404 ^/(?:wgw-content|wgw-plugins|packages)(?:/|$)
RedirectMatch 404 ^/\.(?:git|svn|hg|env|htaccess|htpasswd|user\.ini)(?:[/.]|$)
RedirectMatch 404 ^/wgw-config\.php\.bak(?:\.|$)
# END wgw-deny
BLOCK;
    }
}
