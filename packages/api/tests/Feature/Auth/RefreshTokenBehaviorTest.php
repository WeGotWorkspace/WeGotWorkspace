<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\ApiRefreshToken;
use App\Models\ApiRevokedToken;
use App\Services\Auth\RefreshCookie;
use App\Services\Auth\RefreshTokenRepository;
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

    public function test_reuse_inside_grace_returns_the_successor_without_rotating_again(): void
    {
        $issued = $this->issueTokenPair();
        $other = $this->issueTokenPair();
        $rotated = $this->refresh($issued['refresh_token']);
        $rotated->assertOk();
        $successor = $this->refreshCookieValue($rotated);

        $replay = $this->refresh($issued['refresh_token']);
        $replay->assertOk();
        $this->assertSame($successor, $this->refreshCookieValue($replay));
        $this->assertNotSame($rotated->json('access_token'), $replay->json('access_token'));

        $presentedHash = RefreshTokenRepository::hashToken($issued['refresh_token']);
        $successorHash = RefreshTokenRepository::hashToken($successor);
        $presented = ApiRefreshToken::query()->where('token_hash', $presentedHash)->first();
        $this->assertNotNull($presented);
        $this->assertSame(1, (int) $presented->revoked);
        $this->assertSame($successorHash, $presented->successor_hash);
        $this->assertNotNull($presented->rotated_at);
        $this->assertGreaterThanOrEqual(time() - 5, (int) $presented->rotated_at);
        $this->assertSame(0, (int) ApiRefreshToken::query()->where('token_hash', $successorHash)->value('revoked'));
        $this->assertSame(2, ApiRefreshToken::query()->where('username', 'alice')->count());

        $this->withBearer((string) $rotated->json('access_token'))->getJson('/api/v1/me')->assertOk();
        $this->withBearer((string) $replay->json('access_token'))->getJson('/api/v1/me')->assertOk();

        $continued = $this->refresh($successor);
        $continued->assertOk();
        $this->assertNotSame($successor, $this->refreshCookieValue($continued));
        $this->refresh($other['refresh_token'])->assertOk();
    }

    public function test_two_presentations_of_the_same_token_share_one_rotation(): void
    {
        $issued = $this->issueTokenPair();
        $first = $this->refresh($issued['refresh_token']);
        $second = $this->refresh($issued['refresh_token']);

        $first->assertOk();
        $second->assertOk();
        $successor = $this->refreshCookieValue($first);
        $this->assertSame($successor, $this->refreshCookieValue($second));
        $this->assertSame(
            1,
            ApiRefreshToken::query()->where('username', 'alice')->where('revoked', 0)->count(),
        );
        $this->withBearer((string) $first->json('access_token'))->getJson('/api/v1/me')->assertOk();
        $this->withBearer((string) $second->json('access_token'))->getJson('/api/v1/me')->assertOk();
        $this->refresh($successor)->assertOk();
    }

    public function test_reuse_of_a_rotated_refresh_token_is_rejected(): void
    {
        $issued = $this->issueTokenPair();
        $other = $this->issueTokenPair();
        $rotated = $this->refresh($issued['refresh_token']);
        $rotated->assertOk();
        $nextRefresh = $this->refreshCookieValue($rotated);

        $presentedHash = RefreshTokenRepository::hashToken($issued['refresh_token']);
        $successorHash = RefreshTokenRepository::hashToken($nextRefresh);
        $familyId = ApiRefreshToken::query()->where('token_hash', $presentedHash)->value('family_id');
        $otherFamilyId = ApiRefreshToken::query()
            ->where('token_hash', RefreshTokenRepository::hashToken($other['refresh_token']))
            ->value('family_id');
        $this->assertIsString($familyId);
        $this->assertIsString($otherFamilyId);
        $this->assertNotSame($familyId, $otherFamilyId);
        $this->assertSame(
            $familyId,
            ApiRefreshToken::query()->where('token_hash', $successorHash)->value('family_id'),
        );

        $this->ageRotation($issued['refresh_token']);

        $this->refresh($issued['refresh_token'])
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid refresh token.',
                'code' => 'unauthorized',
            ]);

        // Outside the grace window, reuse is theft: revoke that family only.
        $this->refresh($nextRefresh)
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid refresh token.',
                'code' => 'unauthorized',
            ]);
        $this->assertSame(1, (int) ApiRefreshToken::query()->where('token_hash', $successorHash)->value('revoked'));
        $this->assertNull(ApiRefreshToken::query()->where('token_hash', $presentedHash)->value('successor_token'));
        $this->refresh($other['refresh_token'])->assertOk();
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

    private function ageRotation(string $refreshToken): void
    {
        ApiRefreshToken::query()
            ->where('token_hash', RefreshTokenRepository::hashToken($refreshToken))
            ->update([
                'rotated_at' => time() - (RefreshTokenRepository::ROTATION_GRACE_SECONDS + 1),
            ]);
    }
}
