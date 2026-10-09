<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class DavWellKnownDiscoveryTest extends TestCase
{
    private const ORIGIN = 'https://team.example';

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.url' => self::ORIGIN]);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function discoveryPathProvider(): array
    {
        return [
            'caldav' => ['/.well-known/caldav'],
            'carddav' => ['/.well-known/carddav'],
        ];
    }

    #[DataProvider('discoveryPathProvider')]
    public function test_discovery_redirects_to_the_dav_root_without_credentials(string $path): void
    {
        foreach (['GET', 'HEAD'] as $method) {
            $response = $this->call($method, $path, [], [], [], ['HTTP_ACCEPT' => '*/*']);

            $response->assertStatus(301);
            $response->assertHeader('Location', self::ORIGIN.'/');
            $this->assertStringStartsWith('https://', (string) $response->headers->get('Location'));
        }
    }

    #[DataProvider('discoveryPathProvider')]
    public function test_discovery_routes_are_not_behind_authentication(string $path): void
    {
        $uri = ltrim($path, '/');
        $matched = null;
        foreach (Route::getRoutes() as $candidate) {
            if ($candidate->uri() === $uri) {
                $matched = $candidate;
                break;
            }
        }

        $this->assertNotNull($matched, $path.' is not registered');
        $middleware = $matched->gatherMiddleware();
        foreach ($middleware as $name) {
            $this->assertDoesNotMatchRegularExpression(
                '/(^|\\.)auth($|\\.)|Authenticate|wgw\\.auth/i',
                $name,
                $path.' must stay reachable before the client sends credentials',
            );
        }
    }

    public function test_check_command_passes_when_both_paths_redirect(): void
    {
        Http::fake([
            self::ORIGIN.'/.well-known/caldav' => Http::response('', 301, ['Location' => self::ORIGIN.'/']),
            self::ORIGIN.'/.well-known/carddav' => Http::response('', 301, ['Location' => self::ORIGIN.'/']),
        ]);

        $exit = Artisan::call('wgw:check-dav-discovery');
        $output = Artisan::output();

        $this->assertSame(0, $exit, $output);
        $this->assertStringContainsString('caldav: OK (301 -> '.self::ORIGIN.'/', $output);
        $this->assertStringContainsString('carddav: OK (301 -> '.self::ORIGIN.'/', $output);
    }

    public function test_check_command_fails_with_nginx_snippet_when_discovery_is_missing(): void
    {
        Http::fake([
            self::ORIGIN.'/.well-known/*' => Http::response('missing', 404),
        ]);

        $exit = Artisan::call('wgw:check-dav-discovery');
        $output = Artisan::output();

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('caldav: FAILED (HTTP 404)', $output);
        $this->assertStringContainsString('carddav: FAILED (HTTP 404)', $output);
        $this->assertStringContainsString('location = /.well-known/caldav  { return 301 '.self::ORIGIN.'/; }', $output);
        $this->assertStringContainsString('location = /.well-known/carddav { return 301 '.self::ORIGIN.'/; }', $output);
    }

    public function test_check_command_fails_when_the_probe_cannot_connect(): void
    {
        Http::fake(function (): void {
            throw new \RuntimeException('connection refused');
        });

        $exit = Artisan::call('wgw:check-dav-discovery');
        $output = Artisan::output();

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('caldav: request failed - connection refused', $output);
        $this->assertStringContainsString('carddav: request failed - connection refused', $output);
    }
}
