<?php

declare(strict_types=1);

namespace App\Services\Meet;

use App\Dav\Auth\SabreUiAuthGate;
use App\Exceptions\ApiHttpException;
use App\Services\Auth\BearerAuthenticationService;
use App\Services\Auth\LoginRateLimiter;
use App\Services\Auth\SabreCredentialValidator;
use Illuminate\Http\Request;

/**
 * Resolves the authenticated username for meet endpoints: JWT bearer,
 * {@code sabre_ui_auth} cookie, or HTTP Basic.
 *
 * Only accounts resolve. A guest-role bearer (a public Drive link session,
 * subject {@code share:<key>}) is not an account: Meet, RTC, presence and
 * collaboration treat it exactly like an anonymous caller.
 */
final class MeetRequestAuth
{
    public function __construct(
        private BearerAuthenticationService $bearer,
        private SabreCredentialValidator $credentials,
        private LoginRateLimiter $limiter,
    ) {}

    /**
     * @return non-empty-string|null
     */
    public function tryAuthenticatedUsername(Request $request, string $realm): ?string
    {
        $principal = $this->bearer->authenticate($request->header('Authorization'));
        if ($principal !== null && $principal['role'] !== 'guest') {
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
        if ($username === '') {
            return null;
        }

        $ip = $request->ip();
        $clientIp = is_string($ip) ? $ip : '';
        if (! $this->limiter->allowProtocol($username, $clientIp)) {
            throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
        }
        if (! $this->credentials->validate($username, $password, $realm)) {
            $this->limiter->hitProtocol($username, $clientIp);

            return null;
        }

        return $username;
    }
}
