<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\RateLimiting\JmapPushRateLimiters;
use App\Http\RateLimiting\WgwApiRateLimiters;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Own rate-limit bucket of the JMAP event source (#1660): about 60/min per
 * user + browser id, a per-account ceiling of about 300/min that rotating
 * browser ids cannot escape, a 429 with `Retry-After`, and no spend on the
 * shared `wgw-api` budget.
 */
final class JmapEventSourceRateLimitTest extends WgwDatabaseTestCase
{
    use InteractsWithJmapEventSource;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.debug' => false]);
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        Cache::flush();
    }

    public function test_the_61st_request_from_one_browser_is_limited_and_other_browsers_are_not(): void
    {
        $bob = $this->issueBearerTokenFor('bob');
        $browser = $this->browserId(1);

        for ($request = 0; $request < JmapPushRateLimiters::BROWSER_REQUESTS_PER_MINUTE; $request++) {
            $this->push($bob, $browser)->assertOk();
        }

        $this->assertRateLimited($this->push($bob, $browser));
        $this->push($bob, $this->browserId(2))->assertOk();
        $this->push($bob, null)->assertOk();
        $this->push($this->issueBearerTokenFor('alice'), $browser)->assertOk();
    }

    public function test_rotating_browser_ids_hits_the_account_ceiling(): void
    {
        $bob = $this->issueBearerTokenFor('bob');
        $browsers = intdiv(JmapPushRateLimiters::ACCOUNT_REQUESTS_PER_MINUTE, JmapPushRateLimiters::BROWSER_REQUESTS_PER_MINUTE);

        for ($browser = 1; $browser <= $browsers; $browser++) {
            for ($request = 0; $request < JmapPushRateLimiters::BROWSER_REQUESTS_PER_MINUTE; $request++) {
                $this->push($bob, $this->browserId($browser))->assertOk();
            }
        }

        // A fresh browser id has its own per-browser budget, but the account is spent.
        $this->assertRateLimited($this->push($bob, $this->browserId($browsers + 1)));
        $this->assertRateLimited($this->push($bob, null));
        $this->push($this->issueBearerTokenFor('alice'), null)->assertOk();
    }

    public function test_a_malformed_browser_id_shares_the_none_bucket(): void
    {
        $bob = $this->issueBearerTokenFor('bob');

        for ($request = 0; $request < JmapPushRateLimiters::BROWSER_REQUESTS_PER_MINUTE; $request++) {
            $this->push($bob, $request % 2 === 0 ? 'NOT-A-BROWSER-ID' : 'zz'.$request)->assertOk();
        }

        $this->assertRateLimited($this->push($bob, null));
    }

    public function test_push_requests_do_not_spend_the_account_api_budget(): void
    {
        $bob = $this->issueBearerTokenFor('bob');
        for ($request = 0; $request < 30; $request++) {
            $this->push($bob, $this->browserId(1))->assertOk();
        }

        $this->withBearer($bob)->getJson('/api/v1/me')
            ->assertOk()
            ->assertHeader('X-RateLimit-Remaining', '599');
    }

    public function test_the_limiter_keys_on_the_principal_and_browser_after_authentication(): void
    {
        $this->app->make(Kernel::class);
        $router = $this->app['router'];
        $route = $router->getRoutes()->match(Request::create('/api/v1/jmap/events/*/state/0', 'GET'));
        $middleware = array_values(array_filter($router->gatherRouteMiddleware($route), 'is_string'));

        $this->assertContains(ThrottleRequests::class.':'.JmapPushRateLimiters::PUSH, $middleware);
        $this->assertNotContains(ThrottleRequests::class.':'.WgwApiRateLimiters::API, $middleware);
        $this->assertLessThan(
            $this->positionOf($middleware, ThrottleRequests::class),
            $this->positionOf($middleware, AuthenticateWgwApi::class),
        );

        $request = Request::create('/api/v1/jmap/events/*/state/0', 'GET', server: [
            'REMOTE_ADDR' => '203.0.113.9',
            'HTTP_X_WGW_BROWSER_ID' => $this->browserId(7),
        ]);
        $request->attributes->set(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE, ['username' => 'bob']);
        $callback = RateLimiter::limiter(JmapPushRateLimiters::PUSH);
        $this->assertIsCallable($callback);
        /** @var list<Limit> $limits */
        $limits = $callback($request);

        $this->assertSame('push:user:bob|browser:'.$this->browserId(7), $limits[0]->key);
        $this->assertSame(60, $limits[0]->maxAttempts);
        $this->assertSame('push:user:bob', $limits[1]->key);
        $this->assertSame(300, $limits[1]->maxAttempts);
    }

    private function push(string $token, ?string $browserId): TestResponse
    {
        return $this->eventSource($token, 'Notification', null, $browserId);
    }

    private function assertRateLimited(TestResponse $response): void
    {
        $response->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');
        $this->assertGreaterThan(0, (int) $response->headers->get('Retry-After'));
    }

    private function browserId(int $n): string
    {
        return str_pad(dechex($n), 32, '0', STR_PAD_LEFT);
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
}
