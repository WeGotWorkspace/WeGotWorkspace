<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Mcp\McpEnabled;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureMcpEnabled
{
    public function __construct(private McpEnabled $mcp) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->isMcpPath($request) || $this->mcp->isOn()) {
            return $next($request);
        }

        if ($request->is('oauth/authorize') && $request->isMethod('GET')) {
            return response()->view('mcp.disabled', [], 403);
        }

        if ($request->is('mcp')) {
            return response()->json([
                'jsonrpc' => '2.0',
                'id' => null,
                'error' => [
                    'code' => -32000,
                    'message' => 'MCP is disabled by your administrator.',
                ],
            ], 403);
        }

        return response()->json([
            'error' => 'temporarily_unavailable',
            'error_description' => 'MCP is disabled by your administrator.',
        ], 403);
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
