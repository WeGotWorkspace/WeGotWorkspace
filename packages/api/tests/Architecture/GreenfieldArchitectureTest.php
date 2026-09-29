<?php

declare(strict_types=1);

namespace Tests\Architecture;

use FilesystemIterator;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

final class GreenfieldArchitectureTest extends TestCase
{
    public function test_greenfield_guard_script_passes(): void
    {
        $script = dirname(__DIR__, 2).'/scripts/greenfield-guard.php';
        $this->assertFileExists($script);

        $cmd = escapeshellarg(PHP_BINARY).' '.escapeshellarg($script).' 2>&1';
        $output = [];
        $exitCode = 0;
        exec($cmd, $output, $exitCode);

        $this->assertSame(
            0,
            $exitCode,
            'greenfield-guard failed:'."\n".implode("\n", $output)
        );
    }

    public function test_split_service_files_are_classes_not_line_limit_traits(): void
    {
        $app = dirname(__DIR__, 2).'/app/Services/';
        $files = [
            'Update/UpdateRunnerBackupArchive.php',
            'Mail/MailFolderOperations.php',
            'Calendars/CalendarEventMutationSupport.php',
            'Contacts/Conversion/VCardToJsContactCoreFields.php',
        ];
        foreach ($files as $file) {
            $source = (string) file_get_contents($app.$file);
            $this->assertStringContainsString('final class ', $source, $file);
            $this->assertDoesNotMatchRegularExpression('/^\s*trait\s+/m', $source, $file);
        }
    }

    public function test_legacy_src_directory_must_not_exist(): void
    {
        $this->assertDirectoryDoesNotExist(dirname(__DIR__, 2).'/src');
    }

    public function test_all_wgw_models_use_uses_wgw_connection(): void
    {
        $modelsDir = dirname(__DIR__, 2).'/app/Models';
        $files = glob($modelsDir.'/*.php') ?: [];
        $this->assertNotEmpty($files, 'Expected app/Models/*.php');

        foreach ($files as $file) {
            $content = (string) file_get_contents($file);
            $this->assertStringContainsString(
                'UsesWgwConnection',
                $content,
                basename($file).' must use UsesWgwConnection'
            );
        }
    }

    public function test_domain_services_do_not_use_wgw_table_query_builder(): void
    {
        $violations = $this->scanDomainServices(static function (string $line): bool {
            return (bool) preg_match('/DB::connection\([^)]+\)->table\(/', $line);
        });

        $this->assertSame(
            [],
            $violations,
            "Domain services must use Eloquent models, not DB::connection()->table():\n".implode("\n", $violations)
        );
    }

    public function test_domain_services_do_not_run_runtime_ddl(): void
    {
        $violations = $this->scanDomainServices(static function (string $line): bool {
            return (bool) preg_match('/\bALTER\s+TABLE\b/i', $line);
        });

        $this->assertSame(
            [],
            $violations,
            "Schema DDL belongs in migrations, not services:\n".implode("\n", $violations)
        );
    }

    /**
     * @param  callable(string): bool  $matches
     * @return list<string>
     */
    private function scanDomainServices(callable $matches): array
    {
        $servicesRoot = dirname(__DIR__, 2).'/app/Services';
        $excludedPrefixes = [
            $servicesRoot.'/Installer/',
            $servicesRoot.'/Update/',
            $servicesRoot.'/Settings/',
            $servicesRoot.'/Admin/',
            $servicesRoot.'/Auth/',
        ];

        $violations = [];
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($servicesRoot, FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $path = $file->getPathname();
            foreach ($excludedPrefixes as $prefix) {
                if (str_starts_with($path, $prefix)) {
                    continue 2;
                }
            }

            $lines = file($path);
            if ($lines === false) {
                continue;
            }

            foreach ($lines as $num => $line) {
                if ($matches($line)) {
                    $relative = 'packages/api/app/Services/'.substr($path, strlen($servicesRoot) + 1);
                    $violations[] = $relative.':'.($num + 1);
                }
            }
        }

        return $violations;
    }
}
