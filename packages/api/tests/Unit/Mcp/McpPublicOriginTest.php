<?php

declare(strict_types=1);

namespace Tests\Unit\Mcp;

use App\Services\Mcp\McpPublicOrigin;
use Illuminate\Http\Request;
use Tests\TestCase;

final class McpPublicOriginTest extends TestCase
{
    private const TUNNEL = 'https://example.ngrok-free.dev';

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['env'] = 'testing';
        config([
            'app.env' => 'testing',
            'wgw.mcp.public_origin' => null,
        ]);
    }

    public function test_configured_origin_is_used_in_local_env(): void
    {
        $this->app['env'] = 'local';
        config([
            'app.env' => 'local',
            'wgw.mcp.public_origin' => self::TUNNEL.'/',
        ]);

        $request = Request::create('https://wegotworkspace.localhost/.well-known/oauth-authorization-server');

        $this->assertSame(self::TUNNEL, McpPublicOrigin::configuredOrigin());
        $this->assertSame(self::TUNNEL.'/mcp', McpPublicOrigin::configuredEndpointUrl());
        $this->assertSame(self::TUNNEL, McpPublicOrigin::for($request));
    }

    public function test_production_ignores_configured_origin(): void
    {
        $this->app['env'] = 'production';
        config([
            'app.env' => 'production',
            'wgw.mcp.public_origin' => self::TUNNEL,
        ]);

        $request = Request::create('https://customer.example/.well-known/oauth-authorization-server');

        $this->assertNull(McpPublicOrigin::configuredOrigin());
        $this->assertNull(McpPublicOrigin::configuredEndpointUrl());
        $this->assertSame('https://customer.example', McpPublicOrigin::for($request));
    }

    public function test_localhost_configured_origin_is_ignored(): void
    {
        config(['wgw.mcp.public_origin' => 'https://wegotworkspace.localhost']);

        $this->assertNull(McpPublicOrigin::configuredOrigin());
    }

    public function test_blank_configured_origin_is_ignored(): void
    {
        config(['wgw.mcp.public_origin' => '  ']);

        $this->assertNull(McpPublicOrigin::configuredOrigin());
    }
}
