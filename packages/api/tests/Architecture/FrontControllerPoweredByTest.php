<?php

declare(strict_types=1);

namespace Tests\Architecture;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * With expose_php on, PHP adds X-Powered-By with its version to every response
 * before any code runs. Removing it from the Symfony response does not touch
 * that header, so each front controller drops it with header_remove() (pentest E-08).
 */
final class FrontControllerPoweredByTest extends TestCase
{
    /**
     * @return array<string, array{string}>
     */
    public static function frontControllers(): array
    {
        $repoRoot = dirname(__DIR__, 4);

        return [
            'install front controller' => [$repoRoot.'/apps/wegotworkspace/index.php'],
            'api public front controller' => [$repoRoot.'/packages/api/public/index.php'],
        ];
    }

    #[DataProvider('frontControllers')]
    public function test_front_controller_removes_the_php_version_header_first(string $path): void
    {
        $source = (string) file_get_contents($path);

        $removePos = strpos($source, "header_remove('X-Powered-By');");
        $requirePos = strpos($source, 'require ');

        $this->assertNotFalse($removePos, basename(dirname($path)).'/index.php must call header_remove(\'X-Powered-By\')');
        $this->assertNotFalse($requirePos);
        $this->assertLessThan($requirePos, $removePos, 'remove the header before anything can send output');
    }
}
