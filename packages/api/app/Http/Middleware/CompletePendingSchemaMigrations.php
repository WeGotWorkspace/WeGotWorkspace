<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Update\PendingSchemaMigrations;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Finishes an update whose migrations did not run before any route touches
 * the database. See {@see PendingSchemaMigrations}.
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
            return response()->json(['message' => 'Finishing a database update. Retry shortly.'], 503, ['Retry-After' => '1']);
        }

        return $next($request);
    }
}
