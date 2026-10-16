<?php

declare(strict_types=1);

namespace Tests\Feature\Security;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\RateLimiting\RtcRoomRateLimiters;
use App\Http\RateLimiting\WgwApiRateLimiters;
use App\Models\User;
use Illuminate\Auth\GenericUser;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Support\WgwDatabaseTestCase;

final class WgwApiRateLimitTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        config(['app.debug' => false]);
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
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited')
            ->assertJsonPath('error', 'Too many requests.')
            ->assertHeader('Retry-After');

        $this->flushHeaders();
        $this->withBearer($bob)->get('/api/v1/me')->assertOk();

        $this->flushHeaders();
        $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ])->assertOk();
    }

    public function test_the_61st_search_is_limited_while_the_account_bucket_still_allows_other_routes(): void
    {
        $alice = $this->issueBearerToken('alice');
        $this->withBearer($alice);

        for ($request = 0; $request < 60; $request++) {
            $this->getJson('/api/v1/search/results?q=hello')->assertOk();
        }

        $this->getJson('/api/v1/search/results?q=hello')
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited')
            ->assertJsonPath('error', 'Too many requests.')
            ->assertHeader('Retry-After');

        $this->getJson('/api/v1/me')->assertOk();
    }

    public function test_browse_mode_does_not_spend_the_search_bucket(): void
    {
        $alice = $this->issueBearerToken('alice');
        $this->withBearer($alice);
        $browse = '/api/v1/search/results?'.http_build_query([
            'sources' => ['file'],
            'extensions' => ['md'],
        ]);

        for ($request = 0; $request < 60; $request++) {
            $this->getJson($browse)->assertOk();
        }

        $this->getJson('/api/v1/search/results?q=hello')->assertOk();
    }

    public function test_auth_rooms_and_dav_routes_stay_outside_the_account_limiter(): void
    {
        $this->assertNotContains('throttle:wgw-api', $this->declaredMiddleware('POST', '/api/v1/auth/token'));
        $this->assertNotContains('throttle:wgw-api', $this->declaredMiddleware('POST', '/api/v1/auth/refresh'));
        $this->assertNotContains('throttle:wgw-api', $this->declaredMiddleware('GET', '/api/v1/rooms/room1/events'));

        // Guests read this before join. The room limiter's actor lookup would
        // count a failed Basic attempt, so the route stays outside both buckets.
        $guestRoom = $this->declaredMiddleware('GET', '/api/v1/meetings/rooms/room1');
        $this->assertNotContains('throttle:wgw-api', $guestRoom);
        $this->assertNotContains('throttle:'.RtcRoomRateLimiters::ROOMS, $guestRoom);

        foreach ([
            'GET /api/v1/search/results',
            'GET /api/v1/admin/state',
            'POST /api/v1/meetings/rooms',
            'GET /api/v1/files/children',
        ] as $route) {
            [$method, $path] = explode(' ', $route, 2);
            $middleware = $this->resolvedMiddleware($method, $path);
            $authAt = $this->positionOf($middleware, AuthenticateWgwApi::class);
            $limitAt = $this->positionOf($middleware, ThrottleRequests::class);
            $this->assertLessThan($limitAt, $authAt, $route);
        }

        $files = $this->resolvedMiddleware('GET', '/api/v1/files/children');
        $this->assertLessThan(
            $this->positionOf($files, AuthenticateWgwApi::class),
            $this->positionOf($files, StartSession::class),
        );

        // The scan budget is consumed inside unified search, not as route middleware,
        // so HTTP and MCP share one counter and a content download does not.
        $search = $this->resolvedMiddleware('GET', '/api/v1/search/results');
        $this->assertContains(ThrottleRequests::class.':'.WgwApiRateLimiters::API, $search);
        $this->assertNotContains(ThrottleRequests::class.':'.WgwApiRateLimiters::SEARCH, $search);
        $content = $this->resolvedMiddleware('GET', '/api/v1/search/results/result-1/content');
        $this->assertNotContains(ThrottleRequests::class.':'.WgwApiRateLimiters::SEARCH, $content);

        $mcp = $this->resolvedMiddleware('POST', '/mcp');
        $this->assertLessThan(
            $this->positionOf($mcp, ThrottleRequests::class),
            $this->positionOf($mcp, Authenticate::class),
        );
        $this->assertContains(ThrottleRequests::class.':'.WgwApiRateLimiters::API, $mcp);
        $this->assertNotContains(AuthenticateWgwApi::class, $mcp);
    }

    public function test_the_limiter_keys_on_the_passport_user_before_the_address(): void
    {
        $alice = User::query()->where('username', 'alice')->firstOrFail();
        $request = Request::create('/mcp', 'POST');
        $request->setUserResolver(static fn (): User => $alice);

        $api = $this->limiter(WgwApiRateLimiters::API, $request);
        $this->assertSame('user:alice', $api->key);
        $this->assertSame(600, $api->maxAttempts);

        $named = Request::create('/mcp', 'POST');
        $named->setUserResolver(static fn (): GenericUser => new GenericUser([
            'id' => 9,
            'username' => 'carol',
        ]));
        $this->assertSame('user:carol', $this->limiter(WgwApiRateLimiters::API, $named)->key);

        $customModel = Request::create('/mcp', 'POST');
        $customModel->setUserResolver(static fn (): GenericUser => new GenericUser([
            'id' => 'office-9',
        ]));
        $this->assertSame('user:office-9', $this->limiter(WgwApiRateLimiters::API, $customModel)->key);

        $anonymous = Request::create('/mcp', 'POST', server: ['REMOTE_ADDR' => '203.0.113.50']);
        $this->assertSame('ip:203.0.113.50', $this->limiter(WgwApiRateLimiters::API, $anonymous)->key);
    }

    /**
     * @return list<string>
     */
    private function declaredMiddleware(string $method, string $path): array
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

    /**
     * @return list<string>
     */
    private function resolvedMiddleware(string $method, string $path): array
    {
        // Aliases and the priority list land on the router when the HTTP kernel resolves.
        $this->app->make(Kernel::class);
        $router = $this->app['router'];
        $route = $router->getRoutes()->match(Request::create($path, $method));
        $middleware = [];
        foreach ($router->gatherRouteMiddleware($route) as $entry) {
            if (is_string($entry)) {
                $middleware[] = $entry;
            }
        }

        return $middleware;
    }

    /**
     * @param  list<string>  $middleware
     */
    private function positionOf(array $middleware, string $class): int
    {
        foreach ($middleware as $index => $entry) {
            if (explode(':', $entry, 2)[0] === $class) {
                return $index;
            }
        }

        $this->fail($class.' is missing from '.implode(', ', $middleware));
    }

    private function limiter(string $name, Request $request): Limit
    {
        $callback = RateLimiter::limiter($name);
        $this->assertIsCallable($callback);
        $limit = $callback($request);
        $this->assertInstanceOf(Limit::class, $limit);

        return $limit;
    }
}
