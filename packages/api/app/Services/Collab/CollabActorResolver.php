<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Meet\MeetRequestAuth;
use Illuminate\Http\Request;

final class CollabActorResolver
{
    public function __construct(private MeetRequestAuth $auth) {}

    /**
     * @return array{username: string, role: string}
     */
    public function requirePrincipal(Request $request): array
    {
        /** @var array{username: string, role: string}|null $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if (is_array($principal) && $principal['username'] !== '') {
            return [
                'username' => (string) $principal['username'],
                'role' => (string) $principal['role'],
            ];
        }

        $realm = (string) config('wgw.auth_realm', 'SabreDAV');
        $username = $this->auth->tryAuthenticatedUsername($request, $realm);
        if ($username === null) {
            throw new CollabResponseException(401, [
                'error' => 'auth_required',
                'message' => 'Sign in to join document collaboration.',
            ]);
        }

        return [
            'username' => $username,
            'role' => 'user',
        ];
    }

    /**
     * @return non-empty-string
     */
    public function requireUsername(Request $request): string
    {
        $username = $this->requirePrincipal($request)['username'];
        if ($username === '') {
            throw new \RuntimeException('Authenticated principal is missing a username.');
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
