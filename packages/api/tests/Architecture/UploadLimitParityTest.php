<?php

declare(strict_types=1);

namespace Tests\Architecture;

use PHPUnit\Framework\TestCase;

/**
 * Shared-host upload caps cannot live in one included ini (Apache needs
 * .htaccess / .user.ini on disk; Docker needs uploads.ini; nginx is operator
 * docs). This lockstep test is the source of truth for the 32M value.
 */
final class UploadLimitParityTest extends TestCase
{
    private const PHP_SIZE = '32M';

    private const NGINX_SIZE = '32m';

    public function test_php_upload_ini_files_agree_on_32m(): void
    {
        foreach ($this->iniFiles() as $relative) {
            $contents = $this->readRepoFile($relative);
            $this->assertSame(self::PHP_SIZE, $this->iniAssignment($contents, 'post_max_size'), $relative);
            $this->assertSame(self::PHP_SIZE, $this->iniAssignment($contents, 'upload_max_filesize'), $relative);
            $this->assertContains(
                strtolower($this->iniAssignment($contents, 'display_errors')),
                ['0', 'off', 'false'],
                $relative.' must set display_errors Off so line-0 post_max_size warnings cannot leak HTML',
            );
        }
    }

    public function test_htaccess_php_value_blocks_agree_on_32m(): void
    {
        foreach ($this->htaccessFiles() as $relative) {
            $contents = $this->readRepoFile($relative);
            $this->assertPhpValues($contents, 'post_max_size', self::PHP_SIZE, $relative);
            $this->assertPhpValues($contents, 'upload_max_filesize', self::PHP_SIZE, $relative);
            $this->assertPhpValues($contents, 'display_errors', '0', $relative);
        }
    }

    public function test_operator_and_dev_server_docs_agree_on_32m(): void
    {
        $install = $this->readRepoFile('INSTALL.md');
        $this->assertMatchesRegularExpression(
            '/client_max_body_size\s+'.preg_quote(self::NGINX_SIZE, '/').'\s*;/',
            $install,
            'INSTALL.md nginx note must stay aligned with PHP 32M',
        );

        $devServer = $this->readRepoFile('packages/api/scripts/dev-php-server.sh');
        $this->assertStringContainsString('-d post_max_size='.self::PHP_SIZE, $devServer);
        $this->assertStringContainsString('-d upload_max_filesize='.self::PHP_SIZE, $devServer);
        $this->assertStringContainsString('-d display_errors=0', $devServer);
    }

    /**
     * @return list<string>
     */
    private function iniFiles(): array
    {
        return [
            'docker/php/uploads.ini',
            'apps/wegotworkspace/.user.ini',
            'packages/api/public/.user.ini',
        ];
    }

    /**
     * @return list<string>
     */
    private function htaccessFiles(): array
    {
        return [
            'apps/wegotworkspace/.htaccess',
            'apps/wegotworkspace/example.htaccess',
            'packages/api/public/.htaccess',
        ];
    }

    private function readRepoFile(string $relative): string
    {
        $path = dirname(__DIR__, 4).'/'.$relative;
        $this->assertFileExists($path, $relative);

        return (string) file_get_contents($path);
    }

    private function iniAssignment(string $contents, string $key): string
    {
        $pattern = '/^\s*'.preg_quote($key, '/').'\s*=\s*(\S+)/m';
        $this->assertMatchesRegularExpression($pattern, $contents, "Expected {$key} assignment");
        preg_match($pattern, $contents, $matches);

        return rtrim($matches[1], ';');
    }

    private function assertPhpValues(string $contents, string $key, string $expected, string $relative): void
    {
        preg_match_all('/php_value\s+'.preg_quote($key, '/').'\s+(\S+)/', $contents, $matches);
        $this->assertNotEmpty($matches[1], $relative.' missing php_value '.$key);
        foreach ($matches[1] as $value) {
            $this->assertSame($expected, $value, $relative.' php_value '.$key);
        }
    }
}
