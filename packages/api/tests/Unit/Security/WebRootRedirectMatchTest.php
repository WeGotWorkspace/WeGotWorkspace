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
    public function test_dav_discovery_redirects_run_before_the_front_controller(string $filename): void
    {
        $path = dirname(__DIR__, 5).'/apps/wegotworkspace/'.$filename;
        $htaccess = (string) file_get_contents($path);
        $caldav = strpos($htaccess, 'RewriteRule ^\\.well-known/caldav$  / [R=301,L]');
        $carddav = strpos($htaccess, 'RewriteRule ^\\.well-known/carddav$ / [R=301,L]');
        $front = strpos($htaccess, 'RewriteRule . index.php [L]');

        $this->assertNotFalse($caldav, $filename.' is missing the caldav discovery redirect');
        $this->assertNotFalse($carddav, $filename.' is missing the carddav discovery redirect');
        $this->assertNotFalse($front, $filename.' is missing the index.php fallback');
        $this->assertLessThan($front, $caldav);
        $this->assertLessThan($front, $carddav);
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
            '/sub/.env',
            '/.user.ini',
            '/.htaccess',
            '/wgw-content/x',
            '/packages/api/.env',
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
}
