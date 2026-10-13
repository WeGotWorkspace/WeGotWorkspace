<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Per-request CSP nonce, resolved as a container singleton so the responder that
 * injects an inline script and the middleware that writes the header see the same
 * value. Generated lazily: a response without an inline script keeps a nonce-free
 * policy, which is what the shell and /api/docs want.
 *
 * One container per request (PHP-FPM, no Octane) is what makes this safe. If WGW
 * ever adopts a worker runtime, this must be reset between requests.
 */
final class CspNonce
{
    private ?string $value = null;

    public function value(): string
    {
        return $this->value ??= base64_encode(random_bytes(16));
    }

    public function issued(): bool
    {
        return $this->value !== null;
    }
}
