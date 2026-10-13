<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class WgwSecurityHeaders
{
    public const HSTS = 'max-age=15552000';

    /**
     * The runtime shell has no inline script. 'wasm-unsafe-eval' covers plugin
     * bundles that compile .wasm; Chromium blocks that under script-src 'self'.
     */
    public static function reportOnlyPolicy(): string
    {
        return implode('; ', [
            "default-src 'self'",
            "script-src 'self' 'wasm-unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' blob: data:",
            "font-src 'self'",
            "connect-src 'self'",
            "media-src 'self' blob:",
            "worker-src 'self'",
            "manifest-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'self'",
            'report-uri /api/v1/csp-reports',
        ]);
    }

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $response->headers->remove('X-Powered-By');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'SAMEORIGIN');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        if (str_contains((string) $response->headers->get('Content-Type'), 'text/html')) {
            $response->headers->set(
                'Content-Security-Policy-Report-Only',
                self::reportOnlyPolicy(),
            );
        }
        if ($request->isSecure()) {
            $response->headers->set('Strict-Transport-Security', self::HSTS);
        }

        return $response;
    }
}
