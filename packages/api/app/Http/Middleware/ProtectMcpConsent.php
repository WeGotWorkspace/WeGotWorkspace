<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Mcp\ConsentIntent;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class ProtectMcpConsent
{
    public function __construct(private ConsentIntent $intent) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->isProtected($request)) {
            return $next($request);
        }

        if (! $this->originAllowed($request)) {
            return $this->reject($request, 'Invalid request origin.');
        }

        $token = $this->intentToken($request);
        if ($token === '' || ! $this->intentMatches($request, $token)) {
            return $this->reject($request, 'Invalid or expired consent token.');
        }

        return $next($request);
    }

    private function intentToken(Request $request): string
    {
        $token = (string) $request->input('intent', '');
        if ($token !== '' || ! $request->is('oauth/session')) {
            return $token;
        }

        return (string) $request->session()->get('mcp_login_intent', '');
    }

    private function intentMatches(Request $request, string $token): bool
    {
        if ($request->is('oauth/session')) {
            return $this->intent->assertValid($token, '_login', 'session');
        }

        $user = $request->user('web');
        $username = $user !== null && isset($user->username) ? (string) $user->username : null;
        $clientId = (string) ($request->input('client_id') ?? $request->query('client_id') ?? '');

        return $this->intent->assertValid($token, $username, $clientId !== '' ? $clientId : null);
    }

    private function isProtected(Request $request): bool
    {
        if ($request->is('oauth/session') && $request->isMethod('POST')) {
            return true;
        }

        return $request->is('oauth/authorize') && in_array($request->method(), ['POST', 'DELETE'], true);
    }

    private function originAllowed(Request $request): bool
    {
        $origin = (string) $request->headers->get('Origin', '');
        $referer = (string) $request->headers->get('Referer', '');
        if ($origin !== '') {
            return $this->sameHost($origin, $request);
        }
        if ($referer !== '') {
            return $this->sameHost($referer, $request);
        }

        return true;
    }

    private function sameHost(string $url, Request $request): bool
    {
        $host = parse_url($url, PHP_URL_HOST);
        $expected = $request->getHost();

        return is_string($host) && strcasecmp($host, $expected) === 0;
    }

    private function reject(Request $request, string $message): Response
    {
        if ($request->expectsJson()) {
            return response()->json(['error' => 'invalid_request', 'error_description' => $message], 403);
        }

        return response($message, 403);
    }
}
