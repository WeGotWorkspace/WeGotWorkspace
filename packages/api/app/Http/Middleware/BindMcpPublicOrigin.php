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
}
