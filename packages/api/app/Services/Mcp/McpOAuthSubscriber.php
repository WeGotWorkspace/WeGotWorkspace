<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\User;
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
}
