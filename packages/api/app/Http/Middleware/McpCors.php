<?php

declare(strict_types=1);

namespace App\Http\Middleware;

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
        if (! $this->isMcpPath($request)) {
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

    private function isMcpPath(Request $request): bool
    {
        return $request->is('mcp')
            || $request->is('mcp/*')
            || $request->is('oauth')
            || $request->is('oauth/*')
            || $request->is('.well-known/oauth-authorization-server')
            || $request->is('.well-known/oauth-authorization-server/*')
            || $request->is('.well-known/oauth-protected-resource')
            || $request->is('.well-known/oauth-protected-resource/*');
    }
}
