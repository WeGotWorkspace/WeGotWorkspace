<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use Illuminate\Support\Facades\Crypt;

final class ConsentIntent
{
    public function issue(string $username, string $clientId): string
    {
        return Crypt::encryptString(json_encode([
            'u' => $username,
            'c' => $clientId,
            'exp' => now()->addMinutes(20)->timestamp,
        ], JSON_THROW_ON_ERROR));
    }

    public function assertValid(string $token, ?string $username = null, ?string $clientId = null): bool
    {
        try {
            $payload = json_decode(Crypt::decryptString($token), true);
        } catch (\Throwable) {
            return false;
        }
        if (! is_array($payload)) {
            return false;
        }
        $exp = (int) ($payload['exp'] ?? 0);
        if ($exp < time()) {
            return false;
        }
        if ($username !== null && (string) ($payload['u'] ?? '') !== $username) {
            return false;
        }
        if ($clientId !== null && (string) ($payload['c'] ?? '') !== $clientId) {
            return false;
        }

        return true;
    }

    public function usernameFrom(string $token): ?string
    {
        try {
            $payload = json_decode(Crypt::decryptString($token), true);
        } catch (\Throwable) {
            return null;
        }

        return is_array($payload) && isset($payload['u']) ? (string) $payload['u'] : null;
    }
}
