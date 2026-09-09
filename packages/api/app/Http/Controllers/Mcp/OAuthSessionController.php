<?php

declare(strict_types=1);

namespace App\Http\Controllers\Mcp;

use App\Auth\SabreUserProvider;
use App\Models\User;
use App\Services\Auth\LoginRateLimiter;
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
            return $this->failed($request, 'Those credentials were not recognized.', 401);
        }

        $this->limiter->reset($username, $ip);
        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        $request->session()->forget('mcp_login_intent');

        $target = McpOAuthLoginRedirect::relativeAuthorize($request);
        if ($request->expectsJson()) {
            return response()->json(['ok' => true, 'redirect' => $target]);
        }

        return redirect($target);
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
