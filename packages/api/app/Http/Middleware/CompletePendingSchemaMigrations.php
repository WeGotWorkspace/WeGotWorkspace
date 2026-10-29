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
        $this->pending->applyIfPending();

        return $next($request);
    }
}
