<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Exceptions\ApiHttpException;
use App\Services\Auth\MfaEnforcement;
use App\Services\Auth\UserMfaService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * When an admin requires TOTP, interactive API calls wait until this user enrolls.
 * DAV, Meet Basic, and MCP are not in this middleware group.
 */
final class EnsureMfaCompliance
{
    public function __construct(
        private MfaEnforcement $enforcement,
        private UserMfaService $mfa,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->enforcement->isRequired()) {
            return $next($request);
        }

        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if (! is_array($principal)) {
            return $next($request);
        }
        $username = strtolower(trim((string) ($principal['username'] ?? '')));
        if ($username === '' || $this->mfa->isEnabled($username) || $this->isExempt($request)) {
            return $next($request);
        }

        throw new ApiHttpException(403, 'Set up two-factor authentication to continue.', 'mfa_setup_required');
    }

    private function isExempt(Request $request): bool
    {
        if ($request->is('api/v1/me') && $request->isMethod('GET')) {
            return true;
        }
        if ($request->is('api/v1/auth') || $request->is('api/v1/auth/*')) {
            return true;
        }

        return $request->is('api/v1/settings/totp') || $request->is('api/v1/settings/totp/*');
    }
}
