<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\User;
use App\Services\Mcp\McpScopes;
use App\Services\Settings\SettingKeys;
use DateTimeImmutable;
use Laravel\Passport\Bridge\AccessToken;
use Laravel\Passport\Bridge\Client as BridgeClient;
use Laravel\Passport\Bridge\Scope;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Passport;
use League\OAuth2\Server\CryptKey;

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

    /**
     * @param  list<string>  $scopes
     */
    protected function mcpBearerToken(User $user, Client $client, array $scopes = []): string
    {
        $scopes = $scopes === [] ? [McpScopes::DRIVE] : $scopes;
        $id = $this->issueMcpGrant($user, $client, $scopes);
        $redirects = $client->redirect_uris;
        $redirectUris = is_array($redirects) ? array_map(strval(...), $redirects) : [];
        $token = new AccessToken(
            (string) $user->getAuthIdentifier(),
            array_map(static fn (string $scope): Scope => new Scope($scope), $scopes),
            new BridgeClient((string) $client->getKey(), (string) $client->name, $redirectUris, false),
        );
        $token->setIdentifier($id);
        $token->setExpiryDateTime(new DateTimeImmutable('+1 hour'));
        $private = (string) config('passport.private_key');
        $token->setPrivateKey(new CryptKey($private, null, false));

        return $token->toString();
    }
}
