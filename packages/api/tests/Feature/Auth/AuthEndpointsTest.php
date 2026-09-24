<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use Illuminate\Support\Facades\DB;
use Tests\Support\WgwDatabaseTestCase;

final class AuthEndpointsTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->seedAliceUser();
    }

    public function test_jwks_returns_public_key(): void
    {
        $response = $this->getJson('/api/v1/.well-known/jwks.json');
        $response->assertOk();
        $response->assertJsonStructure(['keys' => [['kty', 'kid', 'n', 'e']]]);
    }

    public function test_token_refresh_me_and_revoke_flow(): void
    {
        $tokenResponse = $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ]);
        $tokenResponse->assertOk();
        $tokenResponse->assertJsonStructure([
            'access_token',
            'refresh_token',
            'token_type',
            'expires_in',
            'refresh_expires_in',
            'role',
            'username',
        ]);
        $this->assertSame('user', $tokenResponse->json('role'));
        $this->assertSame((int) config('wgw.jwt.refresh_ttl'), (int) $tokenResponse->json('refresh_expires_in'));
        $access = (string) $tokenResponse->json('access_token');
        $refresh = (string) $tokenResponse->json('refresh_token');

        $me = $this->withBearer($access)->getJson('/api/v1/me');
        $me->assertOk();
        $me->assertJson([
            'username' => 'alice',
            'role' => 'user',
        ]);

        $refreshed = $this->postJson('/api/v1/auth/refresh', [
            'refresh_token' => $refresh,
        ]);
        $refreshed->assertOk();
        $refreshed->assertJsonStructure([
            'access_token',
            'refresh_token',
            'token_type',
            'expires_in',
            'refresh_expires_in',
            'role',
            'username',
        ]);
        $this->assertSame((int) config('wgw.jwt.refresh_ttl'), (int) $refreshed->json('refresh_expires_in'));
        $newAccess = (string) $refreshed->json('access_token');
        $this->assertNotSame('', $newAccess);
        $newRefresh = (string) $refreshed->json('refresh_token');

        $refreshRow = DB::connection('wgw')
            ->table('api_refresh_tokens')
            ->where('token_hash', hash('sha256', $newRefresh))
            ->first();
        $this->assertNotNull($refreshRow);
        $expectedRefreshExpiry = time() + (int) config('wgw.jwt.refresh_ttl');
        $actualRefreshExpiry = (int) ($refreshRow->expires_at ?? 0);
        $this->assertGreaterThanOrEqual($expectedRefreshExpiry - 5, $actualRefreshExpiry);
        $this->assertLessThanOrEqual($expectedRefreshExpiry + 5, $actualRefreshExpiry);

        $revoke = $this->withBearer($newAccess)->postJson('/api/v1/auth/revoke', [
            'refresh_token' => $newRefresh,
        ]);
        $revoke->assertOk();
        $revoke->assertJson(['ok' => true]);

        $this->withBearer($newAccess)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_invalid_credentials_return_401(): void
    {
        $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'wrong',
        ])
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid credentials.',
                'code' => 'unauthorized',
            ]);
    }

    public function test_admin_role_when_in_administrators_group(): void
    {
        $group = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $alicePrincipal = Principal::forUsername('alice');
        $this->assertNotNull($alicePrincipal);
        $this->addPrincipalToGroup($group, $alicePrincipal);

        $response = $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ]);
        $response->assertOk();
        $this->assertSame('admin', $response->json('role'));
    }

    public function test_disabled_user_cannot_issue_or_refresh_tokens(): void
    {
        $tokenResponse = $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ]);
        $tokenResponse->assertOk();
        $refresh = (string) $tokenResponse->json('refresh_token');

        User::query()->where('username', 'alice')->update(['enabled' => false]);

        $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ])
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid credentials.',
                'code' => 'unauthorized',
            ]);

        $this->postJson('/api/v1/auth/refresh', [
            'refresh_token' => $refresh,
        ])
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid credentials.',
                'code' => 'unauthorized',
            ]);
    }

    private function seedAliceUser(): void
    {
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->seedWgwUser('alice', displayName: 'Alice');
    }
}
