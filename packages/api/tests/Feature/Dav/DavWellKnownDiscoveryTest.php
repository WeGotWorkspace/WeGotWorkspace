<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use Illuminate\Session\Middleware\StartSession;
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
     * @return array<string, array{0: string, 1: string}>
     */
    public static function discoveryPathProvider(): array
    {
        $cases = [];
        foreach (['caldav', 'carddav'] as $service) {
            foreach (['GET', 'HEAD', 'PROPFIND'] as $method) {
                $cases[$service.' '.$method] = ['/.well-known/'.$service, $method];
            }
        }

        return $cases;
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function discoveryServiceProvider(): array
    {
        return [
            'caldav' => ['/.well-known/caldav'],
            'carddav' => ['/.well-known/carddav'],
        ];
    }

    #[DataProvider('discoveryPathProvider')]
    public function test_discovery_redirects_to_the_dav_root_without_credentials(string $path, string $method): void
    {
        $response = $this->call($method, $path, [], [], [], ['HTTP_ACCEPT' => '*/*']);

        $response->assertStatus(301);
        $response->assertHeader('Location', self::ORIGIN.'/');
        $this->assertStringStartsWith('https://', (string) $response->headers->get('Location'));
    }

    public function test_discovery_redirect_uses_the_installed_base_uri(): void
    {
        config([
            'app.url' => 'https://example.com/ignored',
            'wgw.install.base_uri' => '/workspace/',
        ]);

        $this->get('/.well-known/caldav')
            ->assertStatus(301)
            ->assertHeader('Location', 'https://example.com/workspace/');
    }

    public function test_discovery_redirect_stays_absolute_when_app_url_has_no_host(): void
    {
        config(['app.url' => '']);

        $this->call('GET', 'https://calendar.example/.well-known/caldav')
            ->assertStatus(301)
            ->assertHeader('Location', 'https://calendar.example/');
    }

    #[DataProvider('discoveryServiceProvider')]
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
        $this->assertContains('PROPFIND', $matched->methods());
        $middleware = $matched->gatherMiddleware();
        $this->assertNotContains(StartSession::class, $middleware);
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

    public function test_check_command_probes_and_reports_the_installed_base_uri(): void
    {
        config(['wgw.install.base_uri' => '/workspace/']);
        Http::fake([
            self::ORIGIN.'/workspace/.well-known/*' => Http::response('', 301, ['Location' => self::ORIGIN.'/workspace/']),
        ]);

        $exit = Artisan::call('wgw:check-dav-discovery');
        $output = Artisan::output();

        $this->assertSame(0, $exit, $output);
        Http::assertSent(fn ($request): bool => $request->url() === self::ORIGIN.'/workspace/.well-known/caldav');
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
        $this->assertStringContainsString('Automatic client discovery is not working on this installation.', $output);
        $this->assertStringNotContainsString('could not reach itself', $output);
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
        $this->assertStringContainsString('This server could not reach itself.', $output);
        $this->assertStringNotContainsString('Automatic client discovery is not working', $output);
    }

    public function test_check_command_fails_when_app_url_is_not_a_public_origin(): void
    {
        config(['app.url' => 'http://localhost']);
        Http::fake();

        $exit = Artisan::call('wgw:check-dav-discovery');
        $output = Artisan::output();

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('APP_URL is not a public origin', $output);
        Http::assertNothingSent();
    }
}
