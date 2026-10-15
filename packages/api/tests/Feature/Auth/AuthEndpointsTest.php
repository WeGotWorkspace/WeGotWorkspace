<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Auth\RefreshCookie;
use App\Services\Auth\RefreshTokenRepository;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Cookie;
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
            'token_type',
            'expires_in',
            'refresh_expires_in',
            'role',
            'username',
        ]);
        $this->assertArrayNotHasKey('refresh_token', $tokenResponse->json());
        $this->assertRefreshCookieIssued($tokenResponse);
        $this->assertSame('user', $tokenResponse->json('role'));
        $this->assertSame((int) config('wgw.jwt.refresh_ttl'), (int) $tokenResponse->json('refresh_expires_in'));
        $access = (string) $tokenResponse->json('access_token');
        $refresh = $this->refreshCookieValue($tokenResponse);

        $me = $this->withBearer($access)->getJson('/api/v1/me');
        $me->assertOk();
        $me->assertJson([
            'username' => 'alice',
            'role' => 'user',
        ]);

        $refreshed = $this->postRefresh($refresh);
        $refreshed->assertOk();
        $refreshed->assertJsonStructure([
            'access_token',
            'token_type',
            'expires_in',
            'refresh_expires_in',
            'role',
            'username',
        ]);
        $this->assertArrayNotHasKey('refresh_token', $refreshed->json());
        $this->assertSame((int) config('wgw.jwt.refresh_ttl'), (int) $refreshed->json('refresh_expires_in'));
        $newAccess = (string) $refreshed->json('access_token');
        $this->assertNotSame('', $newAccess);
        $newRefresh = $this->refreshCookieValue($refreshed);
        $this->assertNotSame($refresh, $newRefresh);

        $refreshRow = DB::connection('wgw')
            ->table('api_refresh_tokens')
            ->where('token_hash', hash('sha256', $newRefresh))
            ->first();
        $this->assertNotNull($refreshRow);
        $expectedRefreshExpiry = time() + (int) config('wgw.jwt.refresh_ttl');
        $actualRefreshExpiry = (int) ($refreshRow->expires_at ?? 0);
        $this->assertGreaterThanOrEqual($expectedRefreshExpiry - 5, $actualRefreshExpiry);
        $this->assertLessThanOrEqual($expectedRefreshExpiry + 5, $actualRefreshExpiry);

        $revoke = $this->withBearer($newAccess)
            ->withUnencryptedCookie(RefreshCookie::NAME, $newRefresh)
            ->withCredentials()
            ->postJson('/api/v1/auth/revoke');
        $revoke->assertOk();
        $revoke->assertJson(['ok' => true]);
        $revoke->assertCookieExpired('sabre_ui_auth');
        $revoke->assertCookieExpired(RefreshCookie::NAME);

        $this->withBearer($newAccess)->getJson('/api/v1/me')->assertUnauthorized();
        $this->postRefresh($newRefresh)->assertUnauthorized();
    }

    public function test_refresh_without_a_cookie_is_unauthorized_and_clears_the_cookie(): void
    {
        $this->postJson('/api/v1/auth/refresh')
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Missing refresh token.',
                'code' => 'unauthorized',
            ])
            ->assertCookieExpired(RefreshCookie::NAME);
    }

    public function test_empty_or_malformed_refresh_cookie_is_rejected_and_cleared(): void
    {
        foreach (['', '   ', 'not-a-real-token'] as $presented) {
            $this->withUnencryptedCookie(RefreshCookie::NAME, $presented)
                ->withCredentials()
                ->postJson('/api/v1/auth/refresh')
                ->assertUnauthorized()
                ->assertJsonPath('code', 'unauthorized')
                ->assertCookieExpired(RefreshCookie::NAME);
        }
    }

    public function test_refresh_token_in_the_body_is_ignored(): void
    {
        $issued = $this->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ])->assertOk();
        $refresh = $this->refreshCookieValue($issued);

        $this->postJson('/api/v1/auth/refresh', [
            'refresh_token' => $refresh,
        ])->assertUnauthorized()
            ->assertJson([
                'error' => 'Missing refresh token.',
                'code' => 'unauthorized',
            ])
            ->assertCookieExpired(RefreshCookie::NAME);

        $this->postRefresh($refresh)->assertOk();
    }

    public function test_refresh_cookie_is_excluded_from_encryption(): void
    {
        $middleware = $this->app->make(EncryptCookies::class);

        $this->assertTrue($middleware->isDisabled(RefreshCookie::NAME));
        $this->assertTrue($middleware->isDisabled('sabre_ui_auth'));
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
        $refresh = $this->refreshCookieValue($tokenResponse);

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

        $this->postRefresh($refresh)
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid credentials.',
                'code' => 'unauthorized',
            ]);
    }

    private function assertRefreshCookieIssued(TestResponse $response): void
    {
        $cookie = $response->getCookie(RefreshCookie::NAME, false);
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame(Cookie::SAMESITE_STRICT, $cookie->getSameSite());
        $this->assertSame('/api/v1/auth', $cookie->getPath());
        $this->assertEqualsWithDelta(
            app(RefreshTokenRepository::class)->refreshTtl(),
            $cookie->getMaxAge(),
            2,
        );
    }

    private function seedAliceUser(): void
    {
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->seedWgwUser('alice', displayName: 'Alice');
    }
}
