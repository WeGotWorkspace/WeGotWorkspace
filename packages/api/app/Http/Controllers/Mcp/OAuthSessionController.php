<?php

declare(strict_types=1);

namespace App\Http\Controllers\Mcp;

use App\Auth\SabreUserProvider;
use App\Models\User;
use App\Services\Auth\LoginRateLimiter;
use App\Services\Mcp\ConsentIntent;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;

final class OAuthSessionController
{
    public function __construct(
        private SabreUserProvider $users,
        private LoginRateLimiter $limiter,
        private ConsentIntent $intent,
    ) {}

    public function show(Request $request): View
    {
        return view('mcp.login', [
            'error' => null,
            'intent' => $this->intent->issue('_login', 'session'),
            'username' => '',
        ]);
    }

    public function store(Request $request): RedirectResponse|View
    {
        $username = strtolower(trim((string) $request->input('username', '')));
        $password = (string) $request->input('password', '');
        $ip = (string) $request->ip();

        if ($username === '' || $password === '') {
            return $this->failed($request, 'Username and password are required.');
        }
        if (! $this->limiter->allow($username, $ip)) {
            return $this->failed($request, 'Too many sign-in attempts. Try again later.');
        }

        $user = $this->users->retrieveByCredentials(['username' => $username]);
        if (! $user instanceof User || ! $this->users->validateCredentials($user, ['password' => $password])) {
            return $this->failed($request, 'Those credentials were not recognized.');
        }

        $this->limiter->reset($username, $ip);
        Auth::guard('web')->login($user);
        $request->session()->regenerate();

        return redirect()->intended('/oauth/authorize');
    }

    private function failed(Request $request, string $message): View
    {
        return view('mcp.login', [
            'error' => $message,
            'intent' => $this->intent->issue('_login', 'session'),
            'username' => (string) $request->input('username', ''),
        ]);
    }
}
