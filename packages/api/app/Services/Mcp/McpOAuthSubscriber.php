<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\McpSession;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Laravel\Mcp\Events\SessionInitialized;
use Laravel\Passport\Events\AccessTokenCreated;
use Laravel\Passport\Events\RefreshTokenCreated;
use Laravel\Passport\Passport;

final class McpOAuthSubscriber
{
    public function __construct(private McpAuditLogger $audit) {}

    public function handleRefreshTokenCreated(RefreshTokenCreated $_event): void
    {
        // Intentionally empty: refresh tokens are always kept, even when the
        // access token has no offline_access scope. The listener stays
        // registered so this policy stays explicit.
    }

    public function handleAccessTokenCreated(AccessTokenCreated $event): void
    {
        $user = User::query()->find($event->userId);
        $client = Passport::client()->newQuery()->find($event->clientId);
        $this->audit->log(
            McpAuditLogger::GRANT_CREATED,
            'ok',
            $user instanceof User ? (string) $user->username : null,
            $event->clientId,
            $client?->name,
        );
    }

    public function handleSessionInitialized(SessionInitialized $event): void
    {
        $user = Auth::guard('api')->user() ?? Auth::user();
        $clientId = null;
        if ($user instanceof User && $user->currentAccessToken() !== null) {
            $token = $user->currentAccessToken();
            if (is_object($token) && isset($token->oauth_client_id) && is_string($token->oauth_client_id) && $token->oauth_client_id !== '') {
                $clientId = $token->oauth_client_id;
            } elseif (is_object($token) && isset($token->client_id)) {
                $clientId = (string) $token->client_id;
            }
        }
        $existing = McpSession::query()->find($event->sessionId);
        if ($existing instanceof McpSession) {
            $existing->last_seen_at = now();
            $existing->save();

            return;
        }
        McpSession::query()->create([
            'id' => $event->sessionId,
            'user_id' => $user instanceof User ? $user->getAuthIdentifier() : null,
            'client_id' => $clientId,
            'created_at' => now(),
            'last_seen_at' => now(),
        ]);
    }
}
