<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Laravel\Passport\Bridge\Client;
use Laravel\Passport\Bridge\Scope;
use Laravel\Passport\Bridge\User;
use League\OAuth2\Server\RequestTypes\AuthorizationRequest;
use League\OAuth2\Server\RequestTypes\AuthorizationRequestInterface;
use Symfony\Component\HttpFoundation\Response;

final class FilterMcpConsentScopes
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->is('oauth/authorize') || ! $request->isMethod('POST')) {
            return $next($request);
        }

        $raw = $request->session()->get('authRequest');
        if (! is_string($raw) || $raw === '') {
            return $next($request);
        }

        $authRequest = unserialize($raw, ['allowed_classes' => [
            AuthorizationRequest::class,
            Client::class,
            Scope::class,
            User::class,
        ]]);
        if (! $authRequest instanceof AuthorizationRequestInterface) {
            return $next($request);
        }

        $submitted = $request->input('scope', $request->input('scopes', []));
        if (! is_array($submitted)) {
            $submitted = is_string($submitted) ? preg_split('/\s+/', $submitted) ?: [] : [];
        }
        $allowed = array_values(array_filter($submitted, is_string(...)));
        $filtered = [];
        foreach ($authRequest->getScopes() as $scope) {
            if (in_array($scope->getIdentifier(), $allowed, true)) {
                $filtered[] = $scope;
            }
        }
        $authRequest->setScopes($filtered);
        $request->session()->put('authRequest', serialize($authRequest));

        return $next($request);
    }
}
