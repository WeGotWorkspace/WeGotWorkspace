<?php

declare(strict_types=1);

namespace App\Services\Principal;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Meet\MeetRequestAuth;
use Illuminate\Http\Request;

/**
 * Authenticated-principal resolution for principal presence rooms. Guests have
 * no Sabre username and are excluded automatically (401).
 */
final class PrincipalActorResolver
{
    public function __construct(private MeetRequestAuth $auth) {}

    /**
     * @return non-empty-string
     */
    public function requireUsername(Request $request): string
    {
        /** @var array{username: string, role: string}|null $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if (is_array($principal) && ($principal['username'] ?? '') !== '') {
            return (string) $principal['username'];
        }

        $realm = (string) config('wgw.auth_realm', 'SabreDAV');
        $username = $this->auth->tryAuthenticatedUsername($request, $realm);
        if ($username === null || $username === '') {
            throw new PrincipalResponseException(401, [
                'error' => 'auth_required',
                'message' => 'Sign in to join the workspace presence room.',
            ]);
        }

        return $username;
    }

    /**
     * @return non-empty-string
     */
    public function ownerMarker(string $username): string
    {
        return 'u:'.$username;
    }
}
