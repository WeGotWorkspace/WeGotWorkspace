<?php

declare(strict_types=1);

namespace App\Http\Controllers\Mcp;

use App\Exceptions\ApiHttpException;
use App\Models\User;
use App\Services\Auth\AuthChallengeService;
use App\Services\Auth\MfaChallengeService;
use App\Services\Auth\PasswordLogin;
use App\Services\Mcp\ConsentIntent;
use App\Services\Mcp\McpOAuthLoginRedirect;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

final class OAuthSessionController
{
    public function __construct(
        private PasswordLogin $passwordLogin,
        private ConsentIntent $intent,
        private AuthChallengeService $challenges,
        private MfaChallengeService $mfa,
    ) {}

    public function show(Request $request): RedirectResponse
    {
        if (Auth::guard('web')->check()) {
            return redirect(McpOAuthLoginRedirect::relativeAuthorize($request));
        }

        $intent = $this->intent->issue('_login', 'session');
        $request->session()->put('mcp_login_intent', $intent);

        return redirect(McpOAuthLoginRedirect::spaLoginUrl($request, $intent));
    }

    public function store(Request $request): RedirectResponse|JsonResponse
    {
        $challengeId = strtolower(trim((string) $request->input('challenge', '')));
        if ($challengeId !== '') {
            return $this->completeChallenge($request, $challengeId);
        }

        $username = strtolower(trim((string) $request->input('username', '')));
        $password = (string) $request->input('password', '');
        $ip = (string) $request->ip();

        if ($username === '' || $password === '') {
            return $this->failed($request, 'Username and password are required.', 400);
        }

        try {
            $result = $this->passwordLogin->accept($username, $password, $ip, 'oauth');
        } catch (ApiHttpException $e) {
            return $this->failed($request, $this->failureMessage($e), $e->getStatusCode());
        }

        if ($result['status'] !== 'ok') {
            if ($request->expectsJson()) {
                return response()->json($result);
            }

            $intent = (string) $request->session()->get('mcp_login_intent', '');

            return redirect(McpOAuthLoginRedirect::spaLoginUrl($request, $intent, (string) $result['status']));
        }

        $user = User::query()->where('username', $username)->first();
        if (! $user instanceof User) {
            return $this->failed($request, 'Those credentials were not recognized.', 401);
        }

        $this->loginWeb($request, $user);

        $target = McpOAuthLoginRedirect::relativeAuthorize($request);
        if ($request->expectsJson()) {
            return response()->json(['ok' => true, 'status' => 'ok', 'redirect' => $target]);
        }

        return redirect($target);
    }

    private function completeChallenge(Request $request, string $challengeId): JsonResponse|RedirectResponse
    {
        $ip = (string) $request->ip();
        $code = $request->input('code');
        $recoveryCode = $request->input('recovery_code');
        $password = $request->input('password');

        try {
            $open = $this->challenges->findOpen($challengeId);
            if (in_array($open->kind, ['totp_setup', 'totp_replace'], true)) {
                $result = $this->mfa->confirm(
                    $challengeId,
                    is_string($code) ? $code : '',
                    $ip,
                    'oauth',
                    is_string($password) ? $password : null,
                );
            } else {
                $result = $this->mfa->verify(
                    $challengeId,
                    is_string($code) ? $code : null,
                    is_string($recoveryCode) ? $recoveryCode : null,
                    $ip,
                    'oauth',
                );
            }
        } catch (ApiHttpException $e) {
            if ($request->expectsJson()) {
                return response()->json([
                    'error' => $e->getMessage(),
                    'code' => $e->errorCode() ?? 'bad_request',
                ], $e->getStatusCode());
            }

            return $this->failed($request, $e->getMessage(), $e->getStatusCode());
        }

        if (($result['status'] ?? '') !== 'ok') {
            if ($request->expectsJson()) {
                return response()->json($result);
            }

            $intent = (string) $request->session()->get('mcp_login_intent', '');

            return redirect(McpOAuthLoginRedirect::spaLoginUrl($request, $intent, (string) $result['status']));
        }

        $username = strtolower(trim((string) ($result['username'] ?? '')));
        $user = User::query()->where('username', $username)->first();
        if (! $user instanceof User) {
            return $this->failed($request, 'Those credentials were not recognized.', 401);
        }

        $this->loginWeb($request, $user);
        $target = McpOAuthLoginRedirect::relativeAuthorize($request);
        $body = ['ok' => true, 'status' => 'ok', 'redirect' => $target];
        if (isset($result['recovery_codes'])) {
            $body['recovery_codes'] = $result['recovery_codes'];
        }
        foreach (['access_token', 'refresh_token', 'token_type', 'expires_in', 'refresh_expires_in', 'role', 'username'] as $key) {
            if (array_key_exists($key, $result)) {
                $body[$key] = $result[$key];
            }
        }

        if ($request->expectsJson()) {
            return response()->json($body);
        }

        return redirect($target);
    }

    private function loginWeb(Request $request, User $user): void
    {
        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        $request->session()->forget('mcp_login_intent');
    }

    private function failureMessage(ApiHttpException $e): string
    {
        return match ($e->getStatusCode()) {
            429 => 'Too many sign-in attempts. Try again later.',
            401 => 'Those credentials were not recognized.',
            default => $e->getMessage(),
        };
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

        return redirect(McpOAuthLoginRedirect::spaLoginUrl($request, $intent, $code));
    }
}
