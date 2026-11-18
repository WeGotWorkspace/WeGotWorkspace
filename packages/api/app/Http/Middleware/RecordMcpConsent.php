<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Mcp\McpConsentRecorder;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Records the browser and time of an approved MCP consent, so Settings can
 * show where each connection was approved.
 *
 * Runs after {@see ProtectMcpConsent} (the intent ties `client_id` to the
 * signed-in user) and after {@see ReplayMcpConsentDecision} (a replayed double
 * submit never reaches this middleware). Only an Allow that Passport answered
 * with an authorization code counts; Deny and errors are not recorded.
 */
final class RecordMcpConsent
{
    public function __construct(private McpConsentRecorder $consents) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        if (! $request->is('oauth/authorize') || $request->method() !== 'POST') {
            return $response;
        }
        if (! $response->isRedirection() || ! $this->issuedCode((string) $response->headers->get('Location', ''))) {
            return $response;
        }
        $user = $request->user('web');
        $username = $user !== null && isset($user->username) ? (string) $user->username : '';
        $clientId = (string) $request->input('client_id', '');
        $this->consents->record($username, $clientId, $request->userAgent());

        return $response;
    }

    private function issuedCode(string $location): bool
    {
        $query = parse_url($location, PHP_URL_QUERY);
        if (! is_string($query) || $query === '') {
            return false;
        }
        parse_str($query, $params);

        return isset($params['code']) && is_string($params['code']) && $params['code'] !== '';
    }
}
