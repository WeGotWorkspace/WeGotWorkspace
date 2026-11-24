<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\McpPaths;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class McpCors
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! McpPaths::matches($request)) {
            return $next($request);
        }

        $response = $next($request);
        $response->headers->set('Access-Control-Allow-Origin', '*');
        $response->headers->set('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
        $response->headers->set(
            'Access-Control-Allow-Headers',
            'Authorization, Content-Type, MCP-Session-Id, Last-Event-ID, MCP-Protocol-Version',
        );
        $response->headers->set('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Session-Id');
        $response->headers->set('Access-Control-Max-Age', '86400');

        return $response;
    }
}
