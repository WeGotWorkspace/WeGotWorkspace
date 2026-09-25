<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\McpSession;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

/**
 * laravel/mcp 1.0 removed SessionInitialized and no longer issues MCP-Session-Id.
 * A successful initialize or server/discover is the connection we still persist.
 */
final class McpSessionRecorder
{
    public function touch(string $sessionId): void
    {
        if ($sessionId === '') {
            return;
        }

        McpSession::query()->where('id', $sessionId)->update(['last_seen_at' => now()]);
    }

    public function recordHandshake(): void
    {
        $user = Auth::guard('api')->user() ?? Auth::user();
        if (! $user instanceof User) {
            return;
        }

        McpSession::query()->create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->getAuthIdentifier(),
            'client_id' => $this->clientId($user),
            'created_at' => now(),
            'last_seen_at' => now(),
        ]);
    }

    private function clientId(User $user): ?string
    {
        $token = $user->currentAccessToken();
        if (! is_object($token)) {
            return null;
        }

        if (isset($token->oauth_client_id) && is_string($token->oauth_client_id) && $token->oauth_client_id !== '') {
            return $token->oauth_client_id;
        }

        if (isset($token->client_id)) {
            $clientId = (string) $token->client_id;

            return $clientId !== '' ? $clientId : null;
        }

        return null;
    }
}
