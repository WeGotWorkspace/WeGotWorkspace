<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Makes a repeated Allow / Deny on the consent page idempotent.
 *
 * Passport pulls `authToken` from the session on the first decision. A second
 * submit of the same form (double click, or a click while the first POST is
 * still in flight) then fails with a 403 "auth token ... different from the
 * session auth token", and the browser shows that 403 instead of following the
 * first redirect back to the assistant. Replay the first decision's redirect
 * for the same auth token instead, for a short window.
 */
final class ReplayMcpConsentDecision
{
    public const SESSION_KEY = 'mcp_consent_decision';

    private const TTL_SECONDS = 120;

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->isDecision($request)) {
            return $next($request);
        }

        $token = (string) $request->input('auth_token', '');
        if ($token === '') {
            return $next($request);
        }

        $sessionToken = $request->session()->get('authToken');
        if (! is_string($sessionToken) || $sessionToken === '') {
            $replay = $this->replay($request, $token);

            return $replay ?? $next($request);
        }

        $response = $next($request);
        if (hash_equals($sessionToken, $token) && $response->isRedirection()) {
            $location = (string) $response->headers->get('Location', '');
            if ($location !== '') {
                $request->session()->put(self::SESSION_KEY, [
                    'token' => hash('sha256', $token),
                    'location' => $location,
                    'expires' => time() + self::TTL_SECONDS,
                ]);
            }
        }

        return $response;
    }

    private function replay(Request $request, string $token): ?RedirectResponse
    {
        $stored = $request->session()->get(self::SESSION_KEY);
        if (! is_array($stored)) {
            return null;
        }
        $expires = (int) ($stored['expires'] ?? 0);
        $hash = (string) ($stored['token'] ?? '');
        $location = (string) ($stored['location'] ?? '');
        if ($expires < time() || $location === '' || ! hash_equals($hash, hash('sha256', $token))) {
            return null;
        }

        return new RedirectResponse($location);
    }

    private function isDecision(Request $request): bool
    {
        return $request->is('oauth/authorize') && in_array($request->method(), ['POST', 'DELETE'], true);
    }
}
