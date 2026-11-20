<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\ApiPasswordResetToken;
use App\Models\ApiRefreshToken;
use App\Models\User;
use App\Services\Auth\AuthTokenService;
use App\Services\Auth\JwtTokenService;
use App\Services\Auth\PasswordRecoveryService;
use App\Services\Auth\UserSessionRevoker;
use Illuminate\Support\Facades\DB;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwRoleFixtures;

/**
 * #2315: a sign-out everywhere refuses access tokens issued before it at once,
 * not when they expire. bob is a user, alice an administrator.
 */
final class AccessTokenEpochTest extends WgwDatabaseTestCase
{
    use WgwRoleFixtures;

    private ?string $previousThrottleEnv = null;

    protected function setUp(): void
    {
        $this->previousThrottleEnv = getenv('WGW_DISABLE_LOGIN_THROTTLE') ?: null;
        parent::setUp();
        $this->configureRoleMatrix();
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

    public function test_password_change_refuses_older_access_tokens(): void
    {
        $changer = $this->userBearerToken();
        $otherDevice = $this->userBearerToken();

        $this->withBearer($changer)->putJson('/api/v1/settings/profile', [
            'password' => 'newpassword12',
            'currentPassword' => 'secret',
        ])->assertOk();

        $this->assertRefused($otherDevice);
        $this->assertRefused($changer);
        $this->assertAccepted($this->issueBearerTokenFor('bob', 'newpassword12'));
    }

    public function test_password_reset_refuses_older_access_tokens(): void
    {
        $old = $this->userBearerToken();
        $resetToken = bin2hex(random_bytes(32));
        ApiPasswordResetToken::query()->create([
            'token_hash' => hash('sha256', $resetToken),
            'username' => 'bob',
            'expires_at' => time() + PasswordRecoveryService::TOKEN_TTL_SECONDS,
        ]);

        $this->postJson('/api/v1/auth/password-resets/'.$resetToken, ['password' => 'newpassword12'])
            ->assertOk();

        $this->assertRefused($old);
        $this->assertAccepted($this->issueBearerTokenFor('bob', 'newpassword12'));
    }

    public function test_admin_role_change_refuses_older_access_tokens(): void
    {
        $old = $this->userBearerToken();

        $this->withBearer($this->adminBearerToken())
            ->patchJson('/api/v1/admin/users/bob', ['isAdmin' => true])
            ->assertOk();

        $this->assertRefused($old);
        $this->assertAccepted($this->userBearerToken());
    }

    public function test_disabling_a_user_refuses_older_access_tokens(): void
    {
        $old = $this->userBearerToken();
        $admin = $this->adminBearerToken();

        $this->withBearer($admin)->patchJson('/api/v1/admin/users/bob', ['enabled' => false])->assertOk();
        $this->assertRefused($old);

        $this->withBearer($admin)->patchJson('/api/v1/admin/users/bob', ['enabled' => true])->assertOk();
        // Enabling again does not bring the old token back: the disable bumped the epoch.
        $this->assertRefused($old);
        $this->assertAccepted($this->userBearerToken());
    }

    public function test_deleting_a_user_refuses_older_access_tokens(): void
    {
        $old = $this->userBearerToken();

        $this->withBearer($this->adminBearerToken())->deleteJson('/api/v1/admin/users/bob')->assertOk();

        $this->assertRefused($old);
    }

    public function test_revoke_all_refuses_older_access_tokens_and_not_newer_ones(): void
    {
        $old = $this->userBearerToken();

        app(UserSessionRevoker::class)->revokeAll('bob');

        $this->assertRefused($old);
        $this->assertAccepted($this->userBearerToken());
    }

    public function test_signing_out_one_device_leaves_the_others_access_tokens_accepted(): void
    {
        $here = $this->issueTokenPair('bob');
        $there = $this->issueTokenPair('bob');

        $this->withBearer($here['access_token'])->postJson('/api/v1/auth/revoke')->assertOk();

        // Only a sign-out everywhere bumps the access-token epoch: clients that send
        // the raw token (collab, Meet) must not see a 401 here.
        $this->assertAccepted($there['access_token']);
        $this->postRefresh($there['refresh_token'])->assertOk();
    }

    public function test_sign_in_that_overlaps_a_revoke_all_is_refused_with_its_refresh_token(): void
    {
        $before = (int) User::query()->where('username', 'bob')->value('access_token_epoch');
        app(UserSessionRevoker::class)->revokeAll('bob');

        try {
            app(AuthTokenService::class)->issueForUsername('bob', $before);
            $this->fail('A sign-in that started before revokeAll() must be refused.');
        } catch (ApiHttpException $e) {
            $this->assertSame(401, $e->getStatusCode());
        }

        $this->assertSame(
            0,
            ApiRefreshToken::query()->where('username', 'bob')->where('revoked', 0)->count(),
        );
    }

    public function test_access_token_from_a_refresh_carries_the_epoch(): void
    {
        $pair = $this->issueTokenPair('bob');
        $refreshed = (string) $this->postRefresh($pair['refresh_token'])->assertOk()->json('access_token');
        $this->assertAccepted($refreshed);

        $this->bumpAccessEpoch();

        $this->assertRefused($refreshed);
    }

    public function test_token_without_the_epoch_claim_stays_valid_until_it_expires(): void
    {
        $user = User::query()->where('username', 'bob')->firstOrFail();
        $legacy = app(JwtTokenService::class)->issue([
            'sub' => 'bob',
            'role' => 'user',
            'exp' => time() + 600,
            'uid' => (int) $user->id,
        ]);

        $this->bumpAccessEpoch();

        $this->assertAccepted($legacy);
    }

    public function test_token_with_a_lower_epoch_is_refused(): void
    {
        $user = User::query()->where('username', 'bob')->firstOrFail();
        $this->bumpAccessEpoch();
        $user->refresh();
        $epoch = (int) $user->access_token_epoch;
        $this->assertGreaterThan(0, $epoch);

        $mint = fn (int $ep): string => app(JwtTokenService::class)->issue([
            'sub' => 'bob',
            'role' => 'user',
            'exp' => time() + 600,
            'uid' => (int) $user->id,
            'ep' => $ep,
        ]);

        $this->assertRefused($mint($epoch - 1));
        $this->assertAccepted($mint($epoch));
    }

    public function test_epoch_check_adds_no_query(): void
    {
        $user = User::query()->where('username', 'bob')->firstOrFail();
        $legacy = app(JwtTokenService::class)->issue([
            'sub' => 'bob',
            'role' => 'user',
            'exp' => time() + 600,
            'uid' => (int) $user->id,
        ]);
        $current = $this->userBearerToken();

        $this->assertSame($this->queriesFor($legacy), $this->queriesFor($current));
    }

    private function bumpAccessEpoch(): void
    {
        User::query()->where('username', 'bob')->increment('access_token_epoch');
    }

    private function queriesFor(string $token): int
    {
        DB::connection('wgw')->flushQueryLog();
        DB::connection('wgw')->enableQueryLog();
        $this->assertAccepted($token);
        $count = count(DB::connection('wgw')->getQueryLog());
        DB::connection('wgw')->disableQueryLog();

        return $count;
    }

    /**
     * @return array{access_token: string, refresh_token: string}
     */
    private function issueTokenPair(string $username): array
    {
        $response = $this->postJson('/api/v1/auth/token', [
            'username' => $username,
            'password' => 'secret',
        ])->assertOk();

        return [
            'access_token' => (string) $response->json('access_token'),
            'refresh_token' => $this->refreshCookieValue($response),
        ];
    }

    private function assertRefused(string $token): void
    {
        $this->withBearer($token)
            ->getJson('/api/v1/me')
            ->assertUnauthorized()
            ->assertJson(['code' => 'unauthorized']);
    }

    private function assertAccepted(string $token): void
    {
        $this->withBearer($token)->getJson('/api/v1/me')->assertOk();
    }
}
