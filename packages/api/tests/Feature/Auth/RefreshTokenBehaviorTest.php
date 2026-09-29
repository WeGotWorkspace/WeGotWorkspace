<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\ApiRevokedToken;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;

final class RefreshTokenBehaviorTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    public function test_refresh_rotates_the_refresh_token(): void
    {
        $issued = $this->issueTokenPair();
        $rotated = $this->refresh($issued['refresh_token']);

        $rotated->assertOk();
        $this->assertNotSame('', (string) $rotated->json('access_token'));
        $this->assertNotSame($issued['refresh_token'], (string) $rotated->json('refresh_token'));
        $this->assertNotSame($issued['access_token'], (string) $rotated->json('access_token'));
    }

    public function test_reuse_of_a_rotated_refresh_token_is_rejected(): void
    {
        $issued = $this->issueTokenPair();
        $rotated = $this->refresh($issued['refresh_token']);
        $rotated->assertOk();
        $nextRefresh = (string) $rotated->json('refresh_token');

        $this->refresh($issued['refresh_token'])
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid refresh token.',
                'code' => 'unauthorized',
            ]);

        // RFC 9700: reuse of a rotated token indicates theft; revoke entire chain
        $this->refresh($nextRefresh)
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid refresh token.',
                'code' => 'unauthorized',
            ]);
    }

    public function test_revoked_access_token_is_rejected_until_refresh(): void
    {
        $issued = $this->issueTokenPair();

        $this->withBearer($issued['access_token'])
            ->postJson('/api/v1/auth/revoke')
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->assertGreaterThan(0, ApiRevokedToken::query()->count());

        $this->withBearer($issued['access_token'])
            ->getJson('/api/v1/me')
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Missing or invalid bearer token.',
                'code' => 'unauthorized',
            ]);

        $this->refresh($issued['refresh_token'])
            ->assertOk()
            ->assertJsonPath('username', 'alice');
    }

    public function test_revoked_refresh_token_cannot_mint_a_new_pair(): void
    {
        $issued = $this->issueTokenPair();

        $this->withBearer($issued['access_token'])
            ->postJson('/api/v1/auth/revoke', [
                'refresh_token' => $issued['refresh_token'],
            ])
            ->assertOk();

        $this->refresh($issued['refresh_token'])
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid refresh token.',
                'code' => 'unauthorized',
            ]);

        $this->withBearer($issued['access_token'])
            ->getJson('/api/v1/me')
            ->assertUnauthorized();
    }

    /**
     * @return array{access_token: string, refresh_token: string}
     */
    private function issueTokenPair(): array
    {
        $response = $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ]);
        $response->assertOk();

        return [
            'access_token' => (string) $response->json('access_token'),
            'refresh_token' => (string) $response->json('refresh_token'),
        ];
    }

    private function refresh(string $refreshToken): TestResponse
    {
        return $this->postJson('/api/v1/auth/refresh', [
            'refresh_token' => $refreshToken,
        ]);
    }
}
