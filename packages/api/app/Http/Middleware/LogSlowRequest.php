<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Timing\RequestTimings;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Logs `jmap.slow_request` for a JMAP call or upload that took longer than
 * `wgw.slow_request_log_ms` (#2244): the JMAP method names and how the time
 * split between database, storage and everything else. It logs the route
 * pattern, not the path, so no account name or other id goes in the log.
 *
 * It writes after the response went out, so it adds no wait for the client.
 */
final class LogSlowRequest
{
    public function __construct(private readonly RequestTimings $timings) {}

    public function handle(Request $request, Closure $next): Response
    {
        $start = $request->server('REQUEST_TIME_FLOAT');
        if (is_numeric($start)) {
            $this->timings->startedAt((float) $start);
        }

        return $next($request);
    }

    public function terminate(Request $request, Response $response): void
    {
        $threshold = (int) config('wgw.slow_request_log_ms', 2000);
        if ($threshold <= 0) {
            return;
        }
        $summary = $this->timings->summary();
        if ($summary['ms'] < $threshold) {
            return;
        }
        $length = $request->headers->get('Content-Length');

        Log::info('jmap.slow_request', [
            'route' => $request->route()?->uri(),
            'status' => $response->getStatusCode(),
            'request_bytes' => is_numeric($length) ? (int) $length : null,
        ] + $summary);
    }
}
