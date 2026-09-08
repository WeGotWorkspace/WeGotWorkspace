<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\McpAuditEvent;
use App\Models\User;
use Laravel\Passport\Client;
use Laravel\Passport\Passport;

final class McpGrantService
{
    public function __construct(private McpAuditLogger $audit) {}

    /**
     * @return list<array{
     *   clientId: string,
     *   clientName: string,
     *   clientOrigin: string,
     *   connectedAt: string,
     *   scopes: list<string>,
     *   lastUsedAt: string|null
     * }>
     */
    public function listForUser(User $user): array
    {
        $tokens = Passport::token()->newQuery()
            ->where('user_id', $user->getAuthIdentifier())
            ->where('revoked', false)
            ->where(function ($query): void {
                $query->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->orderByDesc('created_at')
            ->get();

        $byClient = [];
        foreach ($tokens as $token) {
            $clientId = (string) $token->getAttribute('client_id');
            if ($clientId === '' || isset($byClient[$clientId])) {
                continue;
            }
            $client = Passport::client()->newQuery()->find($clientId);
            $origin = '';
            $name = 'Assistant';
            if ($client instanceof Client) {
                $origin = (string) ($client->getAttribute('cimd_origin') ?: $this->originFromRedirects($client));
                $name = (string) $client->name;
            }
            $scopes = $token->getAttribute('scopes');
            $byClient[$clientId] = [
                'clientId' => $clientId,
                'clientName' => $name,
                'clientOrigin' => $origin,
                'connectedAt' => optional($token->getAttribute('created_at'))?->toIso8601String() ?? now()->toIso8601String(),
                'scopes' => is_array($scopes) ? array_values($scopes) : [],
                'lastUsedAt' => $this->lastUsedAt((string) $user->username, $clientId),
            ];
        }

        return array_values($byClient);
    }

    public function revoke(User $user, string $clientId): bool
    {
        $tokens = Passport::token()->newQuery()
            ->where('user_id', $user->getAuthIdentifier())
            ->where('client_id', $clientId)
            ->where('revoked', false)
            ->get();
        if ($tokens->isEmpty()) {
            return false;
        }
        $ids = $tokens->modelKeys();
        Passport::token()->newQuery()->whereIn('id', $ids)->update(['revoked' => true]);
        Passport::refreshToken()->newQuery()->whereIn('access_token_id', $ids)->update(['revoked' => true]);
        $client = Passport::client()->newQuery()->find($clientId);
        $this->audit->log(
            McpAuditLogger::GRANT_REVOKED,
            'ok',
            (string) $user->username,
            $clientId,
            $client instanceof Client ? (string) $client->name : null,
        );

        return true;
    }

    private function lastUsedAt(string $username, string $clientId): ?string
    {
        $at = McpAuditEvent::query()
            ->where('username', $username)
            ->where('client_id', $clientId)
            ->where('event_type', McpAuditLogger::TOOL_CALL)
            ->max('created_at');

        return is_string($at) && $at !== '' ? $at : null;
    }

    private function originFromRedirects(Client $client): string
    {
        $uris = $client->redirect_uris;
        $first = is_array($uris) ? ($uris[0] ?? '') : '';
        if (! is_string($first) || $first === '') {
            return '';
        }

        return McpRedirectUris::originOf($first);
    }
}
