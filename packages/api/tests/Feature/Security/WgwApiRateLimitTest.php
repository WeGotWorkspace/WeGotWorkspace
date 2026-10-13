<?php

declare(strict_types=1);

namespace Tests\Feature\Security;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Tests\Support\WgwDatabaseTestCase;

final class WgwApiRateLimitTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        Cache::flush();
    }

    public function test_the_601st_request_is_limited_for_that_user_only(): void
    {
        $alice = $this->issueBearerToken('alice');
        $bob = $this->issueBearerToken('bob');

        $this->withHeader('Authorization', 'Bearer not-a-token')
            ->get('/api/v1/me')
            ->assertUnauthorized();

        $this->withBearer($alice);
        for ($request = 0; $request < 600; $request++) {
            $this->get('/api/v1/me')->assertOk();
        }

        $this->withHeader('X-Forwarded-For', '203.0.113.50')
            ->get('/api/v1/me')
            ->assertStatus(429);

        $this->flushHeaders();
        $this->withBearer($bob)->get('/api/v1/me')->assertOk();

        $this->flushHeaders();
        $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ])->assertOk();
    }

    public function test_auth_rooms_and_dav_routes_stay_outside_the_limiter(): void
    {
        $this->assertNotContains('throttle:wgw-api', $this->middlewareFor('POST', '/api/v1/auth/token'));
        $this->assertNotContains('throttle:wgw-api', $this->middlewareFor('POST', '/api/v1/auth/refresh'));
        $this->assertNotContains('throttle:wgw-api', $this->middlewareFor('GET', '/api/v1/rooms/room1/events'));
        $this->assertNotContains('throttle:wgw-api', $this->middlewareFor('POST', '/api/v1/rtc/metrics'));

        foreach ([
            'GET /api/v1/search/results',
            'GET /api/v1/admin/state',
            'POST /api/v1/meetings/rooms',
        ] as $route) {
            [$method, $path] = explode(' ', $route, 2);
            $middleware = $this->middlewareFor($method, $path);
            $authAt = array_search('wgw.auth', $middleware, true);
            $limitAt = array_search('throttle:wgw-api', $middleware, true);
            $this->assertIsInt($authAt);
            $this->assertIsInt($limitAt);
            $this->assertLessThan($limitAt, $authAt);
        }
    }

    /**
     * @return list<string>
     */
    private function middlewareFor(string $method, string $path): array
    {
        $route = $this->app['router']->getRoutes()->match(Request::create($path, $method));
        $middleware = [];
        foreach ($route->gatherMiddleware() as $entry) {
            if (is_string($entry)) {
                $middleware[] = $entry;
            }
        }

        return $middleware;
    }
}
