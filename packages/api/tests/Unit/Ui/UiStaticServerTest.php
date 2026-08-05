<?php

declare(strict_types=1);

namespace Tests\Unit\Ui;

use App\Ui\UiStaticServer;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class UiStaticServerTest extends TestCase
{
    public function test_serves_asset_and_spa_fallback(): void
    {
        $dist = sys_get_temp_dir().'/wgw-static-'.uniqid('', true);
        mkdir($dist.'/assets', 0775, true);
        file_put_contents($dist.'/index.html', '<!doctype html><title>App</title>');
        file_put_contents($dist.'/assets/app.js', 'console.log(1);');

        $server = new UiStaticServer;
        $this->assertTrue($server->distReady($dist));
        $this->assertTrue($server->matchesShellPath('', '/drive/'));
        $this->assertTrue($server->matchesShellPath('', '/contacts/'));
        $this->assertTrue($server->matchesShellPath('', '/docs'));
        $this->assertTrue($server->matchesShellPath('', '/share/a4ce06285e2e44adb3c55ef3beddf65e'));
        $this->assertTrue($server->matchesShellPath('', '/tasks/lists/inbox'));

        $response = $server->tryServe($dist, '', '/assets/app.js', false);
        $this->assertNotNull($response);
        $this->assertSame(200, $response->getStatusCode());
        $this->assertInstanceOf(BinaryFileResponse::class, $response);
        $file = $response->getFile();
        $this->assertNotNull($file);
        $this->assertStringContainsString('console.log', (string) file_get_contents($file->getPathname()));
    }

    public function test_resolve_route_prefix_prefers_install_over_root(): void
    {
        $server = new UiStaticServer;
        $prefixes = [
            '/',
            '/install',
        ];

        $this->assertSame('/install', $server->resolveRoutePrefix('', '/install/assets/app.js', $prefixes));
        $this->assertSame('/', $server->resolveRoutePrefix('', '/', $prefixes));
        $this->assertNull($server->resolveRoutePrefix('', '/mail/inbox', $prefixes));
    }

    public function test_serves_index_html_at_site_root(): void
    {
        $dist = sys_get_temp_dir().'/wgw-static-index-'.uniqid('', true);
        mkdir($dist, 0775, true);
        file_put_contents($dist.'/index.html', '<!doctype html><title>App</title>');

        $server = new UiStaticServer;
        $this->assertTrue($server->matchesShellPath('', '/index.html'));

        $response = $server->tryServe($dist, '', '/index.html', false);

        $this->assertNotNull($response);
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('text/html; charset=utf-8', $response->headers->get('Content-Type'));
    }

    public function test_serves_service_worker_at_site_root(): void
    {
        $dist = sys_get_temp_dir().'/wgw-static-sw-'.uniqid('', true);
        mkdir($dist, 0775, true);
        file_put_contents($dist.'/index.html', '<!doctype html><title>App</title>');
        file_put_contents($dist.'/sw.js', 'self.addEventListener("install", () => self.skipWaiting());');

        $server = new UiStaticServer;
        $response = $server->tryServe($dist, '', '/sw.js', false);

        $this->assertNotNull($response);
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('application/javascript; charset=utf-8', $response->headers->get('Content-Type'));
    }

    public function test_serves_workbox_runtime_at_site_root(): void
    {
        $dist = sys_get_temp_dir().'/wgw-static-workbox-'.uniqid('', true);
        mkdir($dist, 0775, true);
        file_put_contents($dist.'/index.html', '<!doctype html><title>App</title>');
        file_put_contents($dist.'/workbox-deadbeef.js', 'self.__WB_MANIFEST=[];');

        $server = new UiStaticServer;
        $response = $server->tryServe($dist, '', '/workbox-deadbeef.js', false);

        $this->assertNotNull($response);
        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_serves_install_scoped_assets(): void
    {
        $dist = sys_get_temp_dir().'/wgw-static-install-'.uniqid('', true);
        mkdir($dist.'/assets', 0775, true);
        file_put_contents($dist.'/index.html', '<!doctype html><title>Install</title>');
        file_put_contents($dist.'/assets/app.js', 'window.__install = true;');

        $server = new UiStaticServer;
        $response = $server->tryServe($dist, '', '/install/assets/app.js', false);

        $this->assertNotNull($response);
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('application/javascript; charset=utf-8', $response->headers->get('Content-Type'));
    }
}
