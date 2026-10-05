<?php

declare(strict_types=1);

namespace Tests\Architecture;

use App\Dav\Storage\FlysystemAclFile;
use App\Dav\Storage\FlysystemFile;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2).'/scripts/autoload-app-classes.php';

/**
 * Autoload every {@code packages/api/app} type so illegal inheritance, missing
 * symbols, and parse errors fail in the Architecture suite (#780).
 *
 * PHP only fatals when the subclass is loaded — {@see GroupSharedFile} extending
 * a previously-final {@see FlysystemFile} stayed hidden because
 * listing never autoloaded the subclass.
 */
final class AutoloadAllAppClassesTest extends TestCase
{
    public function test_every_app_php_class_autoloads(): void
    {
        $appRoot = dirname(__DIR__, 2).'/app';
        $types = autoload_app_classes_discover($appRoot);
        $this->assertNotEmpty($types, 'Expected PHP types under packages/api/app');

        $failures = autoload_app_classes_load($types);
        $this->assertSame(
            [],
            $failures,
            "Autoloading app classes failed:\n".implode("\n", $failures)
        );

        $names = array_column($types, 'type');
        $this->assertContains(\App\Dav\Server\GroupSharedFile::class, $names);
        $this->assertTrue(class_exists(\App\Dav\Server\GroupSharedFile::class, false));
        $this->assertTrue(class_exists(FlysystemAclFile::class, false));
    }

    public function test_extending_a_final_class_fails_the_autoload_walk(): void
    {
        $script = dirname(__DIR__, 2).'/scripts/autoload-app-classes.php';
        $fixture = dirname(__DIR__).'/fixtures/AutoloadFinalExtend';
        $autoload = dirname(__DIR__, 2).'/vendor/autoload.php';

        $cmd = implode(' ', [
            escapeshellarg(PHP_BINARY),
            escapeshellarg($script),
            escapeshellarg('--root='.$fixture),
            escapeshellarg('--autoload='.$autoload),
        ]).' 2>&1';

        $output = [];
        $exitCode = 0;
        exec($cmd, $output, $exitCode);
        $combined = implode("\n", $output);

        $this->assertNotSame(
            0,
            $exitCode,
            "Expected class B extends final A to fail the walker:\n{$combined}"
        );
        $this->assertStringContainsString('cannot extend final class', $combined);
        $this->assertStringContainsString('IllegalChild', $combined);
        $this->assertStringNotContainsString('http', strtolower($combined));
        $this->assertStringNotContainsString('principals/', $combined);
    }

    public function test_local_smoke_command_is_wired_without_network(): void
    {
        $console = (string) file_get_contents(dirname(__DIR__, 2).'/routes/console.php');
        $composer = (string) file_get_contents(dirname(__DIR__, 2).'/composer.json');

        $this->assertStringContainsString('wgw:autoload-app-classes', $console);
        $this->assertStringContainsString('autoload-app-classes.php', $console);
        $this->assertStringContainsString('"autoload-app-classes"', $composer);
    }
}
