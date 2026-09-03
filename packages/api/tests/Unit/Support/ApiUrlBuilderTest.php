<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\ApiUrlBuilder;
use Illuminate\Http\Request;
use Tests\TestCase;

final class ApiUrlBuilderTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'wgw.public_web_url' => null,
            'wgw.vite_dev_port' => null,
            'wgw.php_dev_port' => null,
        ]);
    }

    public function test_app_path_uses_request_host_when_spa_and_api_share_origin(): void
    {
        $urls = $this->builder(Request::create('http://workspace.test/api/v1/admin/state', 'GET'));

        $this->assertSame('http://workspace.test/logout', $urls->logout());
        $this->assertSame('http://workspace.test/login/reset', $urls->appPath('login/reset'));
        $this->assertSame('http://workspace.test/api/v1/auth/token', $urls->v1('auth/token'));
    }

    public function test_app_path_uses_configured_public_web_url_instead_of_api_host(): void
    {
        config(['wgw.public_web_url' => 'http://localhost:5194']);
        $urls = $this->builder(Request::create('http://127.0.0.1:9080/api/v1/auth/password-resets', 'POST'));

        $this->assertSame('http://localhost:5194/login/reset', $urls->appPath('login/reset'));
        $this->assertSame('http://localhost:5194/logout', $urls->logout());
        $this->assertSame('http://127.0.0.1:9080/api/v1/auth/token', $urls->v1('auth/token'));
    }

    public function test_app_path_uses_vite_dev_port_when_request_is_api_bind(): void
    {
        config(['wgw.vite_dev_port' => 5194]);
        $urls = $this->builder(Request::create('http://127.0.0.1:9080/api/v1/admin/state', 'GET'));

        $this->assertSame('http://localhost:5194/logout', $urls->logout());
    }

    public function test_app_path_uses_vite_dev_port_when_php_bind_is_not_9080(): void
    {
        config([
            'wgw.vite_dev_port' => 5174,
            'wgw.php_dev_port' => 9081,
        ]);
        $urls = $this->builder(Request::create('http://127.0.0.1:9081/api/v1/admin/state', 'GET'));

        $this->assertSame('http://localhost:5174/logout', $urls->logout());
    }

    public function test_app_path_prefers_loopback_origin_header_over_api_bind(): void
    {
        $request = Request::create('http://127.0.0.1:9080/api/v1/auth/password-resets', 'POST');
        $request->headers->set('Origin', 'http://localhost:5194');
        $urls = $this->builder($request);

        $this->assertSame('http://localhost:5194/login/reset', $urls->appPath('login/reset'));
    }

    public function test_app_path_ignores_non_loopback_origin_on_api_bind(): void
    {
        $request = Request::create('http://127.0.0.1:9080/api/v1/auth/password-resets', 'POST');
        $request->headers->set('Origin', 'https://evil.example');
        $urls = $this->builder($request);

        $this->assertSame('http://127.0.0.1:9080/login/reset', $urls->appPath('login/reset'));
    }

    public function test_configured_public_web_url_does_not_override_same_origin_api_paths(): void
    {
        config(['wgw.public_web_url' => 'http://localhost:5194']);
        $urls = $this->builder(Request::create('http://workspace.test/api/v1/capabilities', 'GET'));

        $this->assertSame('http://localhost:5194/logout', $urls->logout());
        $this->assertSame('http://workspace.test/api/v1/capabilities', $urls->v1('capabilities'));
    }

    private function builder(Request $request): ApiUrlBuilder
    {
        $this->app->instance('request', $request);

        return $this->app->make(ApiUrlBuilder::class);
    }
}
