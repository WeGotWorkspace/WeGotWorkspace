<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Auth\JwtTokenService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RejectSpaJwtOnMcp
{
    public function __construct(private JwtTokenService $jwt) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $header = (string) $request->header('Authorization', '');
        if (! str_starts_with($header, 'Bearer ')) {
            return $next($request);
        }
        $token = trim(substr($header, 7));
        if ($token === '' || substr_count($token, '.') !== 2) {
            return $next($request);
        }

        $kid = $this->kidFrom($token);
        if ($kid === null) {
            return $next($request);
        }
        if ($this->jwt->validate($token, $kid) !== null) {
            return response()->json([
                'jsonrpc' => '2.0',
                'id' => null,
                'error' => [
                    'code' => -32001,
                    'message' => 'SPA access tokens are not accepted on /mcp. Complete the OAuth flow.',
                ],
            ], 401);
        }

        return $next($request);
    }

    private function kidFrom(string $token): ?string
    {
        $parts = explode('.', $token);
        $header = json_decode((string) base64_decode(strtr($parts[0], '-_', '+/'), true), true);
        if (! is_array($header) || ! isset($header['kid']) || ! is_string($header['kid'])) {
            return null;
        }

        return $header['kid'];
    }
}
