<?php

declare(strict_types=1);

namespace Tests\Architecture;

use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RegexIterator;
use SplFileInfo;

/**
 * abortIfExceeded() exits with its own JSON. That is only safe before Laravel
 * boots — confirm the sole call site is public/index.php after autoload.
 */
final class WgwOversizedPostFrontControllerTest extends TestCase
{
    public function test_abort_if_exceeded_is_only_called_from_public_index_before_laravel(): void
    {
        $apiRoot = dirname(__DIR__, 2);
        $indexPath = $apiRoot.'/public/index.php';
        $index = (string) file_get_contents($indexPath);

        $autoloadPos = strpos($index, "require __DIR__.'/../vendor/autoload.php'");
        $abortPos = strpos($index, 'WgwOversizedPost::abortIfExceeded()');
        $handlePos = strpos($index, 'handleRequest');

        $this->assertNotFalse($autoloadPos, 'public/index.php must load Composer before abortIfExceeded');
        $this->assertNotFalse($abortPos, 'public/index.php must call abortIfExceeded()');
        $this->assertNotFalse($handlePos, 'public/index.php must still hand off to Laravel');
        $this->assertGreaterThan($autoloadPos, $abortPos);
        $this->assertLessThan($handlePos, $abortPos);

        $callSites = [];
        $iterator = new RegexIterator(
            new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($apiRoot, RecursiveDirectoryIterator::SKIP_DOTS),
            ),
            '/\.php$/',
        );
        foreach ($iterator as $file) {
            if (! $file instanceof SplFileInfo) {
                continue;
            }
            $path = $file->getPathname();
            if (str_contains($path, '/vendor/') || str_contains($path, '/storage/') || str_contains($path, '/tests/')) {
                continue;
            }
            $contents = (string) file_get_contents($path);
            if (! str_contains($contents, 'WgwOversizedPost::abortIfExceeded()')) {
                continue;
            }
            $callSites[] = substr($path, strlen($apiRoot) + 1);
        }

        $this->assertSame(
            ['public/index.php'],
            $callSites,
            'abortIfExceeded() must stay in the front controller only',
        );
    }
}
