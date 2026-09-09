<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Mcp\McpPublicOrigin;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\URL;
use Symfony\Component\HttpFoundation\Response;

final class BindMcpPublicOrigin
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->isMcpPublicSurface($request)) {
            return $next($request);
        }

        $origin = McpPublicOrigin::for($request);
        if (! McpPublicOrigin::isPublicOrigin($origin)) {
            return $next($request);
        }

        URL::forceRootUrl($origin);
        $scheme = parse_url($origin, PHP_URL_SCHEME);
        if (is_string($scheme) && $scheme !== '') {
            URL::forceScheme($scheme);
        }

        return $next($request);
    }

    private function isMcpPublicSurface(Request $request): bool
    {
        return $request->is([
            'mcp',
            'mcp/*',
            'oauth',
            'oauth/*',
            '.well-known/oauth-authorization-server',
            '.well-known/oauth-authorization-server/*',
            '.well-known/oauth-protected-resource',
            '.well-known/oauth-protected-resource/*',
        ]);
    }
}
