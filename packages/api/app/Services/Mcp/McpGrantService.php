<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\McpAuditEvent;
use App\Models\User;
use Illuminate\Support\Carbon;
use Laravel\Passport\Client;
use Laravel\Passport\Passport;
use Laravel\Passport\Token;

final class McpGrantService
{
    public function __construct(
        private McpAuditLogger $audit,
        private McpConsentRecorder $consents,
    ) {}

    /**
     * Active MCP grants of the user, one per OAuth client, newest first.
     *
     * Only clients registered through MCP (CIMD metadata or DCR; both set
     * `cimd_origin`) are listed, so a future non-MCP OAuth client never shows
     * up under AI assistants.
     *
     * @return list<array{
     *   clientId: string,
     *   clientName: string,
     *   clientOrigin: string,
     *   clientRegistration: 'cimd'|'dcr',
     *   connectedAt: string,
     *   approvedAt: string|null,
     *   approvedUserAgent: string|null,
     *   scopes: list<string>,
     *   lastUsedAt: string|null
     * }>
     */
    public function listForUser(User $user): array
    {
        $username = (string) $user->username;
        $tokens = Passport::token()->newQuery()
            ->where('user_id', $user->getAuthIdentifier())
            ->where('revoked', false)
            ->orderByDesc('created_at')
            ->get();
        $consents = $this->consents->forUser($username);

        $byClient = [];
        foreach ($tokens as $token) {
            $clientId = (string) $token->getAttribute('client_id');
            if ($clientId === '' || isset($byClient[$clientId])) {
                continue;
            }
            $client = Passport::client()->newQuery()->find($clientId);
            if (! $client instanceof Client || ! $this->isMcpClient($client)) {
                continue;
            }
            if (! $this->grantIsActive($token)) {
                continue;
            }
            $scopes = $token->getAttribute('scopes');
            $scopeIds = is_array($scopes) ? array_values(array_filter($scopes, is_string(...))) : [];
            $consent = $consents[$clientId] ?? null;
            $byClient[$clientId] = [
                'clientId' => $clientId,
                'clientName' => (string) $client->name,
                'clientOrigin' => (string) ($client->getAttribute('cimd_origin') ?: $this->originFromRedirects($client)),
                'clientRegistration' => $this->isCimdClient($client) ? 'cimd' : 'dcr',
                'connectedAt' => $consent['approvedAt'] ?? $this->firstGrantAt($username, $clientId, $token),
                'approvedAt' => $consent['approvedAt'] ?? null,
                'approvedUserAgent' => $consent['userAgent'] ?? null,
                'scopes' => McpScopes::userFacingIds($scopeIds),
                'lastUsedAt' => $this->lastUsedAt($username, $clientId),
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
        $this->consents->forget((string) $user->username, $clientId);
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

    private function grantIsActive(Token $token): bool
    {
        $expiresAt = $token->getAttribute('expires_at');
        if ($expiresAt === null || $expiresAt > now()) {
            return true;
        }

        return Passport::refreshToken()->newQuery()
            ->where('access_token_id', $token->getKey())
            ->where('revoked', false)
            ->where(function ($query): void {
                $query->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->exists();
    }

    private function isMcpClient(Client $client): bool
    {
        return $this->isCimdClient($client) || (string) $client->getAttribute('cimd_origin') !== '';
    }

    private function isCimdClient(Client $client): bool
    {
        return (string) $client->getAttribute('cimd_url') !== '';
    }

    /**
     * Connect time for a grant approved before consents were recorded: the
     * first `grant_created` audit row (each token issue logs one, refreshes
     * too, so the earliest is the connect), else the current token.
     */
    private function firstGrantAt(string $username, string $clientId, Token $token): string
    {
        $at = McpAuditEvent::query()
            ->where('username', $username)
            ->where('client_id', $clientId)
            ->where('event_type', McpAuditLogger::GRANT_CREATED)
            ->min('created_at');
        if (is_string($at) && $at !== '') {
            return Carbon::parse($at)->toIso8601String();
        }

        return optional($token->getAttribute('created_at'))?->toIso8601String() ?? now()->toIso8601String();
    }

    private function lastUsedAt(string $username, string $clientId): ?string
    {
        $at = McpAuditEvent::query()
            ->where('username', $username)
            ->where('client_id', $clientId)
            ->where('event_type', McpAuditLogger::TOOL_CALL)
            ->max('created_at');

        return is_string($at) && $at !== '' ? Carbon::parse($at)->toIso8601String() : null;
    }

    private function originFromRedirects(Client $client): string
    {
        $first = $client->redirect_uris[0] ?? '';
        if ($first === '') {
            return '';
        }

        return McpRedirectUris::originOf($first);
    }
}
