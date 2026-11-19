<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\AuthChallenge;
use App\Models\MfaRecoveryCode;
use App\Models\UserMfa;
use App\Services\Admin\AdminUserProvisionerService;
use App\Services\Auth\AuthTokenService;
use App\Services\Auth\Mfa\TotpService;
use App\Services\Auth\Mfa\UserMfaService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Support\TwoFactorTestHelpers;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Admin and CLI reset of a user's two-factor (#2273), the admin user list, and
 * user deletion.
 */
final class MfaAdminTest extends WgwDatabaseTestCase
{
    use TwoFactorTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTwoFactorWorld();
    }

    protected function tearDown(): void
    {
        $this->tearDownTwoFactorWorld();
        parent::tearDown();
    }

    public function test_reset_restores_password_sign_in(): void
    {
        $this->turnOnMfa('bob');
        $this->challengeFor('bob');
        $session = app(AuthTokenService::class)->issueForUsername('bob');

        $this->asAdmin()->postJson('/api/v1/admin/users/bob/mfa-resets')->assertOk()->assertJsonPath('ok', true);

        $this->assertSame(0, UserMfa::query()->count());
        $this->assertSame(0, MfaRecoveryCode::query()->count());
        $this->assertSame(0, AuthChallenge::query()->count());
        $this->postRefresh($session['refresh_token'])->assertUnauthorized();
        $this->signInWithPassword('bob')->assertOk()->assertJsonPath('status', 'ok');
    }

    public function test_reset_works_when_the_secret_cannot_be_decrypted(): void
    {
        $this->turnOnMfa('bob');
        DB::connection('wgw')->table('user_mfa')->where('username', 'bob')->update(['totp_secret' => 'sealed-under-an-old-key']);

        $this->asAdmin()->postJson('/api/v1/admin/users/bob/mfa-resets')->assertOk();

        $this->signInWithPassword('bob')->assertJsonPath('status', 'ok');
    }

    public function test_reset_of_an_unknown_user_is_not_found(): void
    {
        $this->asAdmin()->postJson('/api/v1/admin/users/nobody/mfa-resets')
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_only_admins_can_reset(): void
    {
        $this->turnOnMfa('bob');
        $carol = app(AuthTokenService::class)->issueForUsername('carol')['access_token'];

        $this->withBearer($carol)->postJson('/api/v1/admin/users/bob/mfa-resets')->assertForbidden();
        $this->flushHeaders()->postJson('/api/v1/admin/users/bob/mfa-resets')->assertUnauthorized();
        $this->assertSame(1, UserMfa::query()->count());
    }

    public function test_cli_reset(): void
    {
        $this->turnOnMfa('bob');

        $this->assertSame(0, Artisan::call('wgw:mfa:reset', ['username' => 'Bob']));
        $this->assertSame(1, Artisan::call('wgw:mfa:reset', ['username' => 'nobody']));

        $this->assertSame(0, UserMfa::query()->count());
        $this->signInWithPassword('bob')->assertJsonPath('status', 'ok');
    }

    public function test_admin_user_list_shows_who_has_two_factor_on(): void
    {
        $this->turnOnMfa('bob');
        // A setup that was started but not confirmed is not on.
        $this->turnOnMfaHalfway('carol');

        $users = collect((array) $this->asAdmin()->getJson('/api/v1/admin/state')->assertOk()->json('users'))
            ->keyBy('username');

        $this->assertTrue($users['bob']['mfaEnabled']);
        $this->assertFalse($users['carol']['mfaEnabled']);
        $this->assertFalse($users['alice']['mfaEnabled']);
    }

    public function test_deleting_a_user_removes_their_two_factor(): void
    {
        $this->turnOnMfa('carol');

        app(AdminUserProvisionerService::class)->delete('carol');
        $this->seedWgwUser('carol', displayName: 'Carol again');

        $this->assertSame(0, UserMfa::query()->where('username', 'carol')->count());
        $this->assertSame(0, MfaRecoveryCode::query()->where('username', 'carol')->count());
        $this->signInWithPassword('carol')->assertJsonPath('status', 'ok');
    }

    private function asAdmin(): static
    {
        return $this->withBearer(app(AuthTokenService::class)->issueForUsername('alice')['access_token']);
    }

    private function turnOnMfaHalfway(string $username): void
    {
        app(UserMfaService::class)->startSetup($username, app(TotpService::class)->generateSecret());
    }
}
