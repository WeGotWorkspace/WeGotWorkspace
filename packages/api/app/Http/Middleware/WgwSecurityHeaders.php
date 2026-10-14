<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\CspNonce;
use App\Support\SecurityHeaderPolicy;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class WgwSecurityHeaders
{
    public function __construct(private CspNonce $nonce) {}

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
                'Content-Security-Policy',
                SecurityHeaderPolicy::policy($this->nonce->issued() ? $this->nonce->value() : null),
            );
        }
        if ($request->isSecure()) {
            $response->headers->set('Strict-Transport-Security', SecurityHeaderPolicy::HSTS);
        }

        return $response;
    }
}
