<?php

declare(strict_types=1);

namespace Tests\Architecture;

use App\Ui\UiStaticServer;
use PHPUnit\Framework\TestCase;

/**
 * Contract: every top-level path in the apps shell router must be allowlisted on
 * UiStaticServer, or production falls through to SabreDAV (see /share in #408 / #410).
 *
 * Playwright e2e remains out of scope for done gates; this static parse is the cheap guard.
 */
final class SpaShellRouteAllowlistTest extends TestCase
{
    public function test_apps_router_top_level_paths_are_allowlisted_on_ui_static_server(): void
    {
        $routesFile = dirname(__DIR__, 4).'/packages/apps/src/wegotworkspace/src/wegotworkspace-routes.tsx';
        $this->assertFileExists($routesFile, 'Expected shell router at '.$routesFile);

        $source = (string) file_get_contents($routesFile);
        preg_match_all('/path:\s*[\'"](\/[^\'"]*)[\'"]/', $source, $matches);
        $this->assertNotEmpty($matches[1], 'Expected at least one path: "…" in wegotworkspace-routes.tsx');

        $topLevel = [];
        foreach ($matches[1] as $path) {
            $topLevel[$this->topLevelPrefix($path)] = true;
        }
        ksort($topLevel);

        $allowlist = array_fill_keys(UiStaticServer::spaRoutePrefixes(), true);
        $missing = [];
        foreach (array_keys($topLevel) as $prefix) {
            if (! isset($allowlist[$prefix])) {
                $missing[] = $prefix;
            }
        }

        $this->assertSame(
            [],
            $missing,
            "Apps router top-level path(s) missing from UiStaticServer::spaRoutePrefixes().\n".
            "Add each prefix to packages/api/app/Ui/UiStaticServer.php and cover it in FrontRoutingTest\n".
            "(precedents: /tasks, /share).\nMissing:\n".implode("\n", $missing)
        );
    }

    private function topLevelPrefix(string $path): string
    {
        if ($path === '/' || $path === '') {
            return '/';
        }

        $trimmed = trim($path, '/');
        $segment = explode('/', $trimmed, 2)[0];

        return '/'.$segment;
    }
}
