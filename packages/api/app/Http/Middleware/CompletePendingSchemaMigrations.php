<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Exceptions\ApiHttpException;
use App\Services\Update\PendingSchemaMigrations;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Finishes an update whose migrations did not run before any route touches
 * the database. See {@see PendingSchemaMigrations}.
 *
 * While another process runs the migrations the request waits for it (up to
 * {@see PendingSchemaMigrations::LOCK_WAIT_SECONDS}) and is then served
 * normally. Only when that wait runs out does it get a 503 with
 * `Retry-After: 1`, never a half-migrated schema.
 */
final class CompletePendingSchemaMigrations
{
    public function __construct(private PendingSchemaMigrations $pending) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->pending->applyIfPending()) {
            throw new ApiHttpException(
                503,
                'Database migrations are running. Try again shortly.',
                'unavailable',
                [],
                ['Retry-After' => 1],
            );
        }

        return $next($request);
    }
}
