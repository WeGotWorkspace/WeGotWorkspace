<?php

declare(strict_types=1);

namespace Tests\Feature\Errors;

use App\Exceptions\ApiHttpException;
use App\Services\Collab\CollabResponseException;
use App\Services\Meet\MeetResponseException;
use App\Services\Principal\PrincipalResponseException;
use App\Services\Rtc\Signaling\RtcSignalingException;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * One render hook for every API error (#1646). The wire shape of each family
 * is pinned here; the per-endpoint tests under Meet, Collab and Principal pin
 * the same bodies on real routes.
 */
final class ApiErrorRenderTest extends TestCase
{
    public function test_api_http_exception_keeps_sentence_code_and_headers(): void
    {
        Route::get('/api/v1/error-probe/http', function (): void {
            throw new ApiHttpException(429, 'Too many requests.', 'rate_limited', [], ['Retry-After' => '7']);
        });

        $this->getJson('/api/v1/error-probe/http')
            ->assertStatus(429)
            ->assertHeader('Retry-After', '7')
            ->assertExactJson(['error' => 'Too many requests.', 'code' => 'rate_limited']);
    }

    public function test_api_http_exception_without_code_sends_error_only(): void
    {
        Route::get('/api/v1/error-probe/http-no-code', function (): void {
            throw new ApiHttpException(400, 'Bad thing.');
        });

        $this->getJson('/api/v1/error-probe/http-no-code')
            ->assertStatus(400)
            ->assertExactJson(['error' => 'Bad thing.']);
    }

    /**
     * @return iterable<string, array{class-string<MeetResponseException|CollabResponseException|PrincipalResponseException>}>
     */
    public static function realtimeFamilies(): iterable
    {
        yield 'meet' => [MeetResponseException::class];
        yield 'collab' => [CollabResponseException::class];
        yield 'principal' => [PrincipalResponseException::class];
    }

    /**
     * @param  class-string<MeetResponseException|CollabResponseException|PrincipalResponseException>  $class
     */
    #[DataProvider('realtimeFamilies')]
    public function test_realtime_error_keeps_code_in_error_and_adds_the_same_code(string $class): void
    {
        Route::get('/api/v1/error-probe/realtime', function () use ($class): void {
            throw new $class(401, 'auth_required', 'Sign in first.');
        });

        $this->getJson('/api/v1/error-probe/realtime')
            ->assertUnauthorized()
            ->assertExactJson([
                'error' => 'auth_required',
                'code' => 'auth_required',
                'message' => 'Sign in first.',
            ]);
    }

    /**
     * @param  class-string<MeetResponseException|CollabResponseException|PrincipalResponseException>  $class
     */
    #[DataProvider('realtimeFamilies')]
    public function test_realtime_error_without_sentence_omits_message(string $class): void
    {
        Route::get('/api/v1/error-probe/realtime-bare', function () use ($class): void {
            throw new $class(400, 'invalid_room');
        });

        $this->getJson('/api/v1/error-probe/realtime-bare')
            ->assertStatus(400)
            ->assertExactJson(['error' => 'invalid_room', 'code' => 'invalid_room']);
    }

    public function test_signaling_failure_rewraps_status_code_and_sentence(): void
    {
        Route::get('/api/v1/error-probe/signaling', function (): void {
            throw MeetResponseException::fromSignaling(new RtcSignalingException(409, [
                'error' => 'peer_id_taken',
                'code' => 'peer_id_taken',
                'message' => 'That peer id is in use — join again with a new one.',
            ]));
        });

        $this->getJson('/api/v1/error-probe/signaling')
            ->assertStatus(409)
            ->assertExactJson([
                'error' => 'peer_id_taken',
                'code' => 'peer_id_taken',
                'message' => 'That peer id is in use — join again with a new one.',
            ]);
    }

    public function test_realtime_errors_are_still_reported_and_api_http_errors_are_not(): void
    {
        Exceptions::fake();
        Route::get('/api/v1/error-probe/report-realtime', function (): void {
            throw new CollabResponseException(403, 'forbidden');
        });
        Route::get('/api/v1/error-probe/report-http', function (): void {
            throw new ApiHttpException(403, 'Forbidden.', 'forbidden');
        });

        $this->getJson('/api/v1/error-probe/report-realtime')->assertForbidden();
        $this->getJson('/api/v1/error-probe/report-http')->assertForbidden();

        Exceptions::assertReported(CollabResponseException::class);
        Exceptions::assertNotReported(ApiHttpException::class);
    }
}
