<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\User;
use App\Services\Mcp\McpScopes;
use App\Services\Settings\SettingKeys;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Passport;

trait ConfiguresMcp
{
    protected function enableMcp(): void
    {
        $this->setAppSetting(SettingKeys::MCP_ENABLED, true);
    }

    protected function disableMcp(): void
    {
        $this->setAppSetting(SettingKeys::MCP_ENABLED, false);
    }

    protected function mcpUser(string $username = 'bob', string $password = 'secret'): User
    {
        $existing = User::query()->where('username', $username)->first();
        if ($existing instanceof User) {
            return $existing;
        }

        return User::factory()->named($username)->withPassword($password)->create();
    }

    protected function mcpClient(string $name = 'Claude', string $origin = 'https://claude.ai'): Client
    {
        $client = app(ClientRepository::class)->createAuthorizationCodeGrantClient(
            name: $name,
            redirectUris: [$origin.'/callback'],
            confidential: false,
            enableDeviceFlow: false,
        );
        $client->forceFill([
            'provider' => 'users',
            'cimd_origin' => $origin,
            'scopes' => McpScopes::ids(),
        ])->save();

        return $client->refresh();
    }

    /**
     * @param  list<string>  $scopes
     */
    protected function issueMcpGrant(User $user, Client $client, array $scopes = []): string
    {
        $id = bin2hex(random_bytes(40));
        Passport::token()->newQuery()->create([
            'id' => $id,
            'user_id' => $user->getAuthIdentifier(),
            'client_id' => $client->getKey(),
            'name' => 'mcp',
            'scopes' => $scopes === [] ? [McpScopes::DRIVE] : $scopes,
            'revoked' => false,
            'expires_at' => now()->addHour(),
        ]);

        return $id;
    }
}
