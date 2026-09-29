<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Exceptions\ApiHttpException;
use App\Services\Auth\RoleAuthorizer;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RequireWgwRole
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next, string $minimumRole = 'user'): Response
    {
        /** @var array{username: string, role: string}|null $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $actual = is_array($principal) ? (string) $principal['role'] : 'guest';

        if (! RoleAuthorizer::allows($actual, $minimumRole)) {
            if ($principal === null) {
                throw new ApiHttpException(401, 'Missing or invalid bearer token.', 'unauthorized');
            }

            throw new ApiHttpException(403, 'Insufficient role.', 'forbidden');
        }

        return $next($request);
    }
}
