<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\ApiRevokedToken;
use App\Services\Auth\RefreshCookie;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;

final class RefreshTokenBehaviorTest extends WgwDatabaseTestCase
{
    private ?string $previousThrottleEnv = null;

    protected function setUp(): void
    {
        $this->previousThrottleEnv = getenv('WGW_DISABLE_LOGIN_THROTTLE') ?: null;
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    protected function tearDown(): void
    {
        if ($this->previousThrottleEnv !== null) {
            putenv("WGW_DISABLE_LOGIN_THROTTLE={$this->previousThrottleEnv}");
            $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = $this->previousThrottleEnv;
        } else {
            putenv('WGW_DISABLE_LOGIN_THROTTLE');
            unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);
        }
        parent::tearDown();
    }

    public function test_refresh_rotates_the_refresh_token(): void
    {
        $issued = $this->issueTokenPair();
        $rotated = $this->refresh($issued['refresh_token']);

        $rotated->assertOk();
        $this->assertArrayNotHasKey('refresh_token', $rotated->json());
        $this->assertNotSame('', (string) $rotated->json('access_token'));
        $rotatedRefresh = $this->refreshCookieValue($rotated);
        $this->assertNotSame($issued['refresh_token'], $rotatedRefresh);
        $this->assertNotSame($issued['access_token'], (string) $rotated->json('access_token'));
    }

    public function test_reuse_of_a_rotated_refresh_token_is_rejected(): void
    {
        $issued = $this->issueTokenPair();
        $rotated = $this->refresh($issued['refresh_token']);
        $rotated->assertOk();
        $nextRefresh = $this->refreshCookieValue($rotated);

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
            ->withUnencryptedCookie(RefreshCookie::NAME, $issued['refresh_token'])
            ->withCredentials()
            ->postJson('/api/v1/auth/revoke')
            ->assertOk()
            ->assertCookieExpired(RefreshCookie::NAME)
            ->assertCookieExpired('sabre_ui_auth');

        $this->refresh($issued['refresh_token'])
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid refresh token.',
                'code' => 'unauthorized',
            ])
            ->assertCookieExpired(RefreshCookie::NAME);

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
            'refresh_token' => $this->refreshCookieValue($response),
        ];
    }

    private function refresh(string $refreshToken): TestResponse
    {
        return $this->postRefresh($refreshToken);
    }
}
