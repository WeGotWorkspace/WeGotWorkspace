<?php

declare(strict_types=1);

namespace Tests\Architecture;

use App\Dav\Server\GroupSharedFile;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2).'/scripts/autoload-app-classes.php';

/**
 * Autoload every {@code packages/api/app} type so illegal inheritance, missing
 * symbols, and parse errors fail in the Architecture suite (#780).
 *
 * The walk runs in a subprocess: a fatal (`Cannot extend final class`) must
 * fail this test (PHPUnit exit 1) instead of killing the suite (exit 255).
 */
final class AutoloadAllAppClassesTest extends TestCase
{
    public function test_every_app_php_class_autoloads(): void
    {
        $appRoot = dirname(__DIR__, 2).'/app';
        $types = autoload_app_classes_discover($appRoot);
        $this->assertNotEmpty($types, 'Expected PHP types under packages/api/app');

        $names = array_column($types, 'type');
        $this->assertContains(GroupSharedFile::class, $names);

        [$exitCode, $output] = $this->runWalker();
        $this->assertSame(
            0,
            $exitCode,
            "Autoloading app classes failed (exit {$exitCode}):\n{$output}"
        );
        $this->assertStringContainsString('autoload-app-classes: ok', $output);
    }

    public function test_extending_a_final_class_fails_the_autoload_walk(): void
    {
        $fixture = dirname(__DIR__).'/fixtures/AutoloadFinalExtend';
        $autoload = dirname(__DIR__, 2).'/vendor/autoload.php';

        [$exitCode, $output] = $this->runWalker([
            '--root='.$fixture,
            '--autoload='.$autoload,
        ]);

        $this->assertNotSame(
            0,
            $exitCode,
            "Expected class B extends final A to fail the walker:\n{$output}"
        );
        $this->assertStringContainsString('cannot extend final class', strtolower($output));
        $this->assertStringContainsString('IllegalChild', $output);
        $this->assertStringNotContainsString('principals/', $output);
    }

    public function test_second_type_in_the_same_file_fails_composer_lookup(): void
    {
        $fixture = dirname(__DIR__).'/fixtures/AutoloadSharedFile';
        $autoload = dirname(__DIR__, 2).'/vendor/autoload.php';

        [$exitCode, $output] = $this->runWalker([
            '--root='.$fixture,
            '--autoload='.$autoload,
        ]);

        $this->assertNotSame(
            0,
            $exitCode,
            "Expected Holder+Stowaway in one file to fail the walker:\n{$output}"
        );
        $this->assertStringContainsString('Stowaway', $output);
        $this->assertStringContainsString('Composer lookup', $output);
    }

    public function test_composer_only_load_reports_a_type_missing_from_psr4(): void
    {
        $failures = autoload_app_classes_load([
            [
                'file' => dirname(__DIR__, 2).'/app/DoesNotExist.php',
                'type' => 'App\\DoesNotExist',
                'kind' => 'class',
            ],
        ], registerFallback: false);

        $this->assertNotEmpty($failures);
        $this->assertStringContainsString('DoesNotExist', implode("\n", $failures));
    }

    /**
     * @param  list<string>  $extraArgs
     * @return array{0: int, 1: string}
     */
    private function runWalker(array $extraArgs = []): array
    {
        $script = dirname(__DIR__, 2).'/scripts/autoload-app-classes.php';
        $parts = [
            escapeshellarg(PHP_BINARY),
            '-d',
            'display_errors=stderr',
            escapeshellarg($script),
        ];
        foreach ($extraArgs as $arg) {
            $parts[] = escapeshellarg($arg);
        }
        $cmd = implode(' ', $parts).' 2>&1';

        $output = [];
        $exitCode = 0;
        exec($cmd, $output, $exitCode);

        return [$exitCode, implode("\n", $output)];
    }
}
