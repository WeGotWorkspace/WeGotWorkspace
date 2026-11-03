<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Middleware\RequireGuestSession;
use App\Http\RateLimiting\GuestUploadRateLimiters;
use App\Services\Jmap\Guest\GuestUploadBudget;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithGuestUploads;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Guest upload limits (#1715): a byte budget per share in shared cache,
 * charged before the body is read; a Content-Length is required; one request
 * bucket per share, so new guest sessions do not mint new budget; and the
 * limiter runs after authentication.
 */
final class JmapGuestUploadLimitsTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithGuestUploads;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config(['wgw.jmap.maintenance_share' => 0, 'app.debug' => false]);
        Cache::flush();
        $this->createDriveDirectory('/users/bob', 'inbox');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_the_byte_budget_is_per_share_and_holds_across_sessions(): void
    {
        config(['wgw.jmap.guest_upload_bytes_per_day' => 10]);
        $link = $this->createGuestLink();
        $first = $this->openGuestSession($link['token']);
        $firstAccount = $this->guestJmapSession($first)['accountId'];

        $this->guestUpload($first, $firstAccount, '123456')->assertCreated();
        $over = $this->guestUpload($first, $firstAccount, '7890ab');
        $over->assertStatus(429)->assertJsonPath('code', 'guest_upload_budget');
        $this->assertGreaterThan(0, (int) $over->headers->get('Retry-After'));

        $second = $this->openGuestSession($link['token']);
        $secondAccount = $this->guestJmapSession($second)['accountId'];
        $this->guestUpload($second, $secondAccount, 'x')->assertStatus(429);
    }

    public function test_the_budget_is_charged_before_the_body_is_read(): void
    {
        config(['wgw.jmap.guest_upload_bytes_per_day' => 100]);
        $link = $this->createGuestLink();
        $guest = $this->openGuestSession($link['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];

        $this->guestUpload($guest, $accountId, 'small', ['Content-Length' => '1000'])->assertStatus(429);

        $this->assertSame(1000, (int) RateLimiter::attempts(GuestUploadBudget::key($link['id'])));
    }

    public function test_a_guest_part_without_content_length_is_refused(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];

        $this->call('POST', '/api/v1/jmap/guest/upload/'.$accountId, server: $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer '.$guest,
            'Content-Type' => 'application/octet-stream',
        ]), content: 'bytes')->assertStatus(411);
    }

    public function test_every_guest_session_of_one_link_shares_one_request_bucket(): void
    {
        $link = $this->createGuestLink();
        $guest = $this->openGuestSession($link['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $key = md5(GuestUploadRateLimiters::UPLOAD.'guest-upload:share:'.$link['id']);
        for ($hit = 0; $hit < GuestUploadRateLimiters::SHARE_REQUESTS_PER_MINUTE; $hit++) {
            RateLimiter::hit($key, 60);
        }

        $this->guestJmap($guest, [['Core/echo', [], 'c']])->assertStatus(429)->assertHeader('Retry-After');
        $fresh = $this->openGuestSession($link['token']);
        $this->guestUpload($fresh, $this->guestJmapSession($fresh)['accountId'], 'x')->assertStatus(429);
    }

    public function test_the_limiter_and_the_guest_check_run_after_authentication(): void
    {
        $this->app->make(Kernel::class);
        $router = $this->app['router'];
        foreach ([['POST', '/api/v1/jmap/guest'], ['POST', '/api/v1/jmap/guest/upload/guest-'.str_repeat('a', 32)]] as [$method, $uri]) {
            $route = $router->getRoutes()->match(Request::create($uri, $method));
            $middleware = array_values(array_filter($router->gatherRouteMiddleware($route), 'is_string'));

            $this->assertContains(ThrottleRequests::class.':'.GuestUploadRateLimiters::UPLOAD, $middleware);
            $auth = $this->positionOf($middleware, AuthenticateWgwApi::class);
            $this->assertLessThan($this->positionOf($middleware, ThrottleRequests::class), $auth, $uri);
            $this->assertLessThan($this->positionOf($middleware, RequireGuestSession::class), $auth, $uri);
        }
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
