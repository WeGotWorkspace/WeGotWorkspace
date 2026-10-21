<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Exceptions\ApiHttpException;
use App\Services\Auth\BearerAuthenticationService;
use App\Services\Auth\JwtConfigService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AuthenticateWgwApi
{
    public const PRINCIPAL_ATTRIBUTE = 'wgw.principal';

    public function __construct(
        private BearerAuthenticationService $bearerAuth,
        private JwtConfigService $jwtConfig,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $principal = $this->bearerAuth->authenticate($request->header('Authorization'));
        if ($principal === null) {
            // Unreadable keys are a server fault, as on /auth/refresh. A 401 here signs clients out.
            if ($this->jwtConfig->signingConfig() === null) {
                throw new ApiHttpException(503, 'JWT key configuration missing.', 'config_error');
            }
            throw new ApiHttpException(401, 'Missing or invalid bearer token.', 'unauthorized');
        }
        $request->attributes->set(self::PRINCIPAL_ATTRIBUTE, $principal);

        return $next($request);
    }
}
