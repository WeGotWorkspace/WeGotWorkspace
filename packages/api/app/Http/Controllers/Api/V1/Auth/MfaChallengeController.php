<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Resources\Api\V1\AuthTokenResource;
use App\Models\AuthChallenge;
use App\Services\Auth\AuthTokenService;
use App\Services\Auth\Mfa\MfaSignIn;
use App\Services\Auth\RefreshCookie;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Pre-auth code step of the web sign-in (#2273). Only `spa` challenges; an
 * `oauth` one completes on `POST /oauth/session`.
 */
final class MfaChallengeController
{
    public function __construct(
        private MfaSignIn $mfa,
        private AuthTokenService $tokens,
        private RefreshCookie $refreshCookie,
    ) {}

    public function verify(Request $request, string $challenge): JsonResponse
    {
        $result = $this->mfa->verify(
            $challenge,
            AuthChallenge::CLIENT_SPA,
            $this->stringInput($request, 'code'),
            $this->stringInput($request, 'recovery_code'),
            (string) $request->ip(),
            $request->getHost(),
        );
        if ($result['status'] !== 'ok') {
            return response()->json($result);
        }

        return $this->signedIn($result['username']);
    }

    public function replace(Request $request, string $challenge): JsonResponse
    {
        $code = $this->stringInput($request, 'code');
        if ($code === null || trim($code) === '') {
            return response()->json(['error' => 'Send the code from your authenticator app.', 'code' => 'bad_request'], 400);
        }

        $result = $this->mfa->replace($challenge, AuthChallenge::CLIENT_SPA, $code, (string) $request->ip());

        return $this->signedIn($result['username'], $result['recovery_codes']);
    }

    /**
     * @param  list<string>|null  $recoveryCodes
     */
    private function signedIn(string $username, ?array $recoveryCodes = null): JsonResponse
    {
        $payload = $this->tokens->issueForUsername($username);
        $body = (new AuthTokenResource($payload))->resolve();
        if ($recoveryCodes !== null) {
            $body['recovery_codes'] = $recoveryCodes;
        }

        return response()->json($body)->withCookie($this->refreshCookie->issue($payload['refresh_token']));
    }

    private function stringInput(Request $request, string $key): ?string
    {
        $value = $request->input($key);
        if ($value === null) {
            return null;
        }
        if (! is_string($value) || strlen($value) > 64) {
            return '';
        }

        return $value;
    }
}
