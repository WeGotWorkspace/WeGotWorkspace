<?php

declare(strict_types=1);

namespace App\Support;

/**
 * CSP and HSTS strings shared by the response middleware and the Apache block
 * for files PHP does not serve.
 */
final class SecurityHeaderPolicy
{
    public const HSTS = 'max-age=15552000';

    /**
     * The runtime shell has no inline script. 'wasm-unsafe-eval' covers plugin
     * bundles that compile .wasm; Chromium blocks that under script-src 'self'.
     * The nonce is only present on responses that injected an inline script
     * (the MCP consent page); every other HTML response gets the same policy
     * Apache sets for /index.html.
     *
     * @param  list<string>  $formActions  extra form-action sources (OAuth consent redirect)
     */
    public static function policy(?string $nonce = null, array $formActions = []): string
    {
        $scriptSrc = "script-src 'self' 'wasm-unsafe-eval'";
        if ($nonce !== null) {
            $scriptSrc .= " 'nonce-".$nonce."'";
        }

        return implode('; ', [
            "default-src 'self'",
            $scriptSrc,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' blob: data:",
            "font-src 'self'",
            "connect-src 'self'",
            "media-src 'self' blob:",
            "worker-src 'self'",
            "manifest-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            implode(' ', ["form-action 'self'", ...$formActions]),
            "frame-ancestors 'self'",
            'report-uri /api/v1/csp-reports',
        ]);
    }
}
