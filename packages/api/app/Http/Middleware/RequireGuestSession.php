<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Exceptions\ApiHttpException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Admits only a guest principal (#1715). `wgw.role` ranks roles, so
 * `wgw.role:guest` would also admit members; the guest upload routes are
 * for guest sessions only, and members keep their own JMAP routes.
 */
final class RequireGuestSession
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if (! is_array($principal)) {
            throw new ApiHttpException(401, 'Missing or invalid bearer token.', 'unauthorized');
        }
        if ((string) ($principal['role'] ?? '') !== 'guest') {
            throw new ApiHttpException(403, 'Only guest sessions use this route.', 'forbidden');
        }

        return $next($request);
    }
}
