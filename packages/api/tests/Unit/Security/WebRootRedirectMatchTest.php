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
