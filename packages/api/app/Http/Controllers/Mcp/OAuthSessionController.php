<?php

declare(strict_types=1);

namespace App\Http\Controllers\Mcp;

use App\Auth\SabreUserProvider;
use App\Exceptions\ApiHttpException;
use App\Models\AuthChallenge;
use App\Models\User;
use App\Services\Auth\LoginRateLimiter;
use App\Services\Auth\Mfa\MfaSignIn;
use App\Services\Mcp\ConsentIntent;
use App\Services\Mcp\McpOAuthLoginRedirect;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

final class OAuthSessionController
{
    public function __construct(
        private SabreUserProvider $users,
        private LoginRateLimiter $limiter,
        private ConsentIntent $intent,
        private MfaSignIn $mfa,
    ) {}

    public function show(Request $request): RedirectResponse
    {
        if (Auth::guard('web')->check()) {
            return redirect(McpOAuthLoginRedirect::relativeAuthorize($request));
        }

        $intent = $this->intent->issue('_login', 'session');
        $request->session()->put('mcp_login_intent', $intent);

        return redirect(McpOAuthLoginRedirect::spaLoginUrl($intent));
    }

    public function store(Request $request): RedirectResponse|JsonResponse
    {
        if ($request->has('challenge')) {
            return $this->codeStep($request);
        }

        $username = strtolower(trim((string) $request->input('username', '')));
        $password = (string) $request->input('password', '');
        $ip = (string) $request->ip();

        if ($username === '' || $password === '') {
            return $this->failed($request, 'Username and password are required.', 400);
        }
        if (! $this->limiter->allow($username, $ip)) {
            return $this->failed($request, 'Too many sign-in attempts. Try again later.', 429);
        }

        $user = $this->users->retrieveByCredentials(['username' => $username]);
        if (! $user instanceof User || ! $this->users->validateCredentials($user, ['password' => $password])) {
            $this->limiter->hit($username, $ip);

            return $this->failed($request, 'Those credentials were not recognized.', 401);
        }

        $this->limiter->reset($username, $ip);

        // Two-factor on (#2273): no web session yet. The code step comes back
        // here with the challenge; it is JSON only, like the SPA login.
        $challenge = $this->mfa->challengeAfterPassword($username, AuthChallenge::CLIENT_OAUTH);
        if ($challenge !== null) {
            if (! $request->expectsJson()) {
                return $this->failed($request, 'Enter the code from your authenticator app.', 401);
            }

            return response()->json($challenge);
        }
        $this->limiter->rememberAddress($username, $ip);

        return $this->signIn($request, $user);
    }

    /**
     * `{challenge, code}` or `{challenge, recovery_code}` on a `login`
     * challenge, then `{challenge, code}` on a `replace` one. JSON only.
     */
    private function codeStep(Request $request): RedirectResponse|JsonResponse
    {
        if (! $request->expectsJson()) {
            return response()->json(['error' => 'Send the code step as JSON.', 'code' => 'bad_request'], 400);
        }

        $id = $this->stringInput($request, 'challenge') ?? '';
        $ip = (string) $request->ip();
        if ($this->mfa->kindOf($id, AuthChallenge::CLIENT_OAUTH) === AuthChallenge::KIND_REPLACE) {
            $code = $this->stringInput($request, 'code');
            if ($code === null || trim($code) === '') {
                return response()->json(['error' => 'Send the code from your authenticator app.', 'code' => 'bad_request'], 400);
            }
            $result = $this->mfa->replace($id, AuthChallenge::CLIENT_OAUTH, $code, $ip);

            return $this->signIn($request, $this->user($result['username']), $result['recovery_codes']);
        }

        $result = $this->mfa->verify(
            $id,
            AuthChallenge::CLIENT_OAUTH,
            $this->stringInput($request, 'code'),
            $this->stringInput($request, 'recovery_code'),
            $ip,
            $request->getHost(),
        );
        if ($result['status'] !== 'ok') {
            return response()->json($result);
        }

        // A sign-out everywhere that committed after the code step began ends this sign-in too.
        if ($this->mfa->accessTokenEpoch($result['username']) !== $result['epoch']) {
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }

        return $this->signIn($request, $this->user($result['username']));
    }

    /**
     * @param  list<string>|null  $recoveryCodes
     */
    private function signIn(Request $request, User $user, ?array $recoveryCodes = null): RedirectResponse|JsonResponse
    {
        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        $request->session()->forget('mcp_login_intent');

        $target = McpOAuthLoginRedirect::relativeAuthorize($request);
        if ($request->expectsJson()) {
            $body = ['ok' => true, 'status' => 'ok', 'redirect' => $target];
            if ($recoveryCodes !== null) {
                $body['recovery_codes'] = $recoveryCodes;
            }

            return response()->json($body);
        }

        return redirect($target);
    }

    private function user(string $username): User
    {
        $user = $this->users->retrieveByCredentials(['username' => $username]);
        if (! $user instanceof User) {
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }

        return $user;
    }

    private function stringInput(Request $request, string $key): ?string
    {
        $value = $request->input($key);
        if ($value === null) {
            return null;
        }

        return is_string($value) && strlen($value) <= 128 ? $value : '';
    }

    private function failed(Request $request, string $message, int $status): JsonResponse|RedirectResponse
    {
        if ($request->expectsJson()) {
            return response()->json(['error' => $message], $status);
        }

        $code = $status === 429 ? 'throttled' : 'invalid';
        $intent = (string) $request->session()->get('mcp_login_intent', '');
        if ($intent === '') {
            $intent = $this->intent->issue('_login', 'session');
            $request->session()->put('mcp_login_intent', $intent);
        }

        return redirect(McpOAuthLoginRedirect::spaLoginUrl($intent, $code));
    }
}
