<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Share dialog loads GET /files/shares/at-path. That route must not depend on Laravel
 * StartSession — SESSION_DRIVER=database without a sessions table would otherwise 500.
 */
final class DriveShareRouteMiddlewareTest extends TestCase
{
    public function test_share_at_path_does_not_use_start_session_middleware(): void
    {
        $matched = null;
        foreach (Route::getRoutes() as $candidate) {
            if ($candidate->uri() === 'api/v1/files/shares/at-path'
                && in_array('GET', $candidate->methods(), true)) {
                $matched = $candidate;
                break;
            }
        }

        $this->assertNotNull($matched, 'Expected GET api/v1/files/shares/at-path to be registered');

        $middleware = $matched->gatherMiddleware();
        $this->assertNotContains(StartSession::class, $middleware);
        $this->assertFalse(
            collect($middleware)->contains(
                static fn (mixed $entry): bool => is_string($entry) && str_contains($entry, 'StartSession')
            )
        );
    }

    public function test_public_share_session_exchange_does_not_use_start_session_middleware(): void
    {
        $matched = null;
        foreach (Route::getRoutes() as $candidate) {
            if ($candidate->uri() === 'api/v1/files/share-sessions'
                && in_array('POST', $candidate->methods(), true)) {
                $matched = $candidate;
                break;
            }
        }

        $this->assertNotNull($matched, 'Expected POST api/v1/files/share-sessions to be registered');

        $middleware = $matched->gatherMiddleware();
        $this->assertNotContains(StartSession::class, $middleware);
    }
}
