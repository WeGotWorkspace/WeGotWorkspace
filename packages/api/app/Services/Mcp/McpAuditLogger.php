<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\McpAuditEvent;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Laravel\Passport\Client;
use Laravel\Passport\Passport;

final class McpAuditLogger
{
    public const TOOL_CALL = 'tool_call';

    public const GRANT_CREATED = 'grant_created';

    public const GRANT_REVOKED = 'grant_revoked';

    public const KILL_SWITCH = 'kill_switch';

    /**
     * @param  array<string, mixed>|string|null  $target
     */
    public function log(
        string $eventType,
        string $outcome,
        ?string $username = null,
        ?string $clientId = null,
        ?string $clientName = null,
        ?string $tool = null,
        ?string $access = null,
        array|string|null $target = null,
    ): void {
        $encoded = is_array($target)
            ? json_encode($target, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
            : $target;

        McpAuditEvent::query()->create([
            'event_type' => $eventType,
            'username' => $username,
            'client_id' => $clientId,
            'client_name' => $clientName,
            'tool' => $tool,
            'access' => $access,
            'outcome' => $outcome,
            'target' => $encoded,
            'created_at' => now(),
        ]);
    }

    public function toolCall(string $tool, string $access, string $outcome, mixed $target = null): void
    {
        $user = Auth::guard('api')->user() ?? Auth::user();
        $username = $user instanceof User ? (string) $user->username : null;
        $client = $this->currentClient($user);

        $this->log(
            self::TOOL_CALL,
            $outcome,
            $username,
            $client['id'],
            $client['name'],
            $tool,
            $access,
            is_array($target) || is_string($target) || $target === null ? $target : null,
        );
    }

    /**
     * @return array{id: ?string, name: ?string}
     */
    private function currentClient(?object $user): array
    {
        if (! $user instanceof User || $user->currentAccessToken() === null) {
            return ['id' => null, 'name' => null];
        }
        $token = $user->currentAccessToken();
        $clientId = null;
        if (is_object($token) && isset($token->oauth_client_id) && is_string($token->oauth_client_id) && $token->oauth_client_id !== '') {
            $clientId = $token->oauth_client_id;
        } elseif (is_object($token) && isset($token->client_id)) {
            $clientId = (string) $token->client_id;
        }
        if ($clientId === null || $clientId === '') {
            return ['id' => null, 'name' => null];
        }
        $client = Passport::client()->newQuery()->find($clientId);

        return [
            'id' => $clientId,
            'name' => $client instanceof Client ? (string) $client->name : null,
        ];
    }
}
