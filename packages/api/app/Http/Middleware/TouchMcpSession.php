<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\McpSession;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class TouchMcpSession
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $sessionId = (string) $request->header('MCP-Session-Id', '');
        if ($sessionId !== '') {
            McpSession::query()->where('id', $sessionId)->update(['last_seen_at' => now()]);
        }

        $length = $request->header('Content-Length');
        if (is_numeric($length) && (int) $length > 1_048_576) {
            return response()->json([
                'jsonrpc' => '2.0',
                'id' => null,
                'error' => [
                    'code' => -32600,
                    'message' => 'Payload too large.',
                ],
            ], 413);
        }

        return $next($request);
    }
}
