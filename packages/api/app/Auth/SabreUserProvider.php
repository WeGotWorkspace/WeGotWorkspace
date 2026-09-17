<?php

declare(strict_types=1);

namespace App\Auth;

use App\Models\User;
use App\Services\Auth\SabreCredentialValidator;
use App\Support\WgwSettings;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Contracts\Auth\UserProvider;

final class SabreUserProvider implements UserProvider
{
    public function __construct(private SabreCredentialValidator $credentials) {}

    public function retrieveById($identifier): ?Authenticatable
    {
        return User::query()->find($identifier);
    }

    public function retrieveByToken($identifier, #[\SensitiveParameter] $token): ?Authenticatable
    {
        return null;
    }

    public function updateRememberToken(Authenticatable $user, #[\SensitiveParameter] $token): void {}

    /**
     * @param  array<string, mixed>  $credentials
     */
    public function retrieveByCredentials(#[\SensitiveParameter] array $credentials): ?Authenticatable
    {
        $username = $credentials['username'] ?? $credentials['email'] ?? null;
        if (! is_string($username) || trim($username) === '') {
            return null;
        }

        return User::query()->where('username', strtolower(trim($username)))->first();
    }

    /**
     * @param  array<string, mixed>  $credentials
     */
    public function validateCredentials(Authenticatable $user, #[\SensitiveParameter] array $credentials): bool
    {
        if (! $user instanceof User) {
            return false;
        }
        $password = $credentials['password'] ?? null;
        if (! is_string($password) || $password === '') {
            return false;
        }
        $realm = (string) (WgwSettings::normalized()[WgwSettings::AUTH_REALM] ?? 'SabreDAV');

        return $this->credentials->validate((string) $user->username, $password, $realm);
    }

    /**
     * @param  array<string, mixed>  $credentials
     */
    public function rehashPasswordIfRequired(Authenticatable $user, #[\SensitiveParameter] array $credentials, bool $force = false): void {}
}
