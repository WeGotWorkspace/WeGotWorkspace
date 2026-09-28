<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Mcp\McpSessionRecorder;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class TouchMcpSession
{
    public function __construct(private McpSessionRecorder $sessions) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $this->sessions->touch((string) $request->header('MCP-Session-Id', ''));

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

        $response = $next($request);
        if ($this->openedConnection($request, $response)) {
            $this->sessions->recordHandshake();
        }

        return $response;
    }

    private function openedConnection(Request $request, Response $response): bool
    {
        $method = $request->input('method');
        if ($method !== 'initialize' && $method !== 'server/discover') {
            return false;
        }
        if ($response->getStatusCode() !== 200) {
            return false;
        }

        $content = $response->getContent();
        if (! is_string($content) || $content === '') {
            return false;
        }

        $decoded = json_decode($content, true);

        return is_array($decoded)
            && array_key_exists('result', $decoded)
            && ! array_key_exists('error', $decoded);
    }
}
