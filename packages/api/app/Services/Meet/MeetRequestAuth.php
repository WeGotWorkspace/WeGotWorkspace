<?php

declare(strict_types=1);

namespace App\Services\Meet;

use App\Dav\Auth\SabreUiAuthGate;
use App\Services\Auth\BearerAuthenticationService;
use App\Services\Auth\SabreCredentialValidator;
use Illuminate\Http\Request;

/**
 * Resolves the authenticated username for meet endpoints: JWT bearer,
 * {@code sabre_ui_auth} cookie, or HTTP Basic.
 */
final class MeetRequestAuth
{
    public function __construct(
        private BearerAuthenticationService $bearer,
        private SabreCredentialValidator $credentials,
    ) {}

    /**
     * @return non-empty-string|null
     */
    public function tryAuthenticatedUsername(Request $request, string $realm): ?string
    {
        $principal = $this->bearer->authenticate($request->header('Authorization'));
        if ($principal !== null) {
            $username = strtolower(trim($principal['username']));
            if ($username !== '') {
                return $username;
            }
        }

        $cookieRaw = $request->cookies->get('sabre_ui_auth');
        $cookieUser = SabreUiAuthGate::validatedUsernameFromRaw(
            is_string($cookieRaw) ? $cookieRaw : null,
            $realm,
        );
        if ($cookieUser !== null) {
            return $cookieUser;
        }

        $header = $request->header('Authorization');
        if (! is_string($header) || ! preg_match('/^Basic\s+(\S+)$/i', $header, $matches)) {
            return null;
        }

        $decoded = base64_decode((string) $matches[1], true);
        if (! is_string($decoded) || ! str_contains($decoded, ':')) {
            return null;
        }

        [$user, $password] = explode(':', $decoded, 2);
        $username = strtolower(trim($user));
        if ($username === '' || ! $this->credentials->validate($username, $password, $realm)) {
            return null;
        }

        return $username;
    }
}
