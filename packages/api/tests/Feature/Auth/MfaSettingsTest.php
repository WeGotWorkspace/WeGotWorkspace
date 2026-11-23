<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\AppPassword;
use App\Models\MfaRecoveryCode;
use App\Models\User;
use App\Models\UserMfa;
use App\Services\Auth\AppPasswordService;
use App\Services\Auth\AuthTokenService;
use App\Services\Auth\LoginRateLimiter;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\Support\TwoFactorTestHelpers;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The caller's authenticator in settings (#2273): start, confirm, turn off and
 * new recovery codes, and the status on `me` and `settings/state`.
 */
final class MfaSettingsTest extends WgwDatabaseTestCase
{
    use TwoFactorTestHelpers {
        turnOnMfa as private turnOnMfaForUser;
    }

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTwoFactorWorld();
        $this->token = app(AuthTokenService::class)->issueForUsername('bob')['access_token'];
    }

    protected function tearDown(): void
    {
        $this->tearDownTwoFactorWorld();
        parent::tearDown();
    }

    public function test_start_returns_a_new_secret_and_leaves_two_factor_off(): void
    {
        $usedAt = Carbon::now()->subDay();
        User::query()->where('username', 'bob')->update(['dav_password_used_at' => $usedAt]);

        $response = $this->settings('POST', 'settings/totp', ['currentPassword' => 'secret'])->assertOk();

        $secret = (string) $response->json('secret');
        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $secret);
        $uri = (string) $response->json('otpauth_uri');
        $this->assertStringStartsWith('otpauth://totp/WeGotWorkspace', $uri);
        $this->assertStringContainsString('bob', $uri);
        $this->assertStringContainsString('secret='.$secret, $uri);
        $this->assertSame($usedAt->toIso8601String(), $response->json('davPasswordUsedAt'));
        // Stored encrypted, not on yet.
        $this->assertStringNotContainsString($secret, (string) UserMfa::query()->where('username', 'bob')->toBase()->value('totp_secret'));
        $this->settings('GET', 'me')->assertJsonPath('mfa.enabled', false);
        $this->signInWithPassword('bob')->assertJsonPath('status', 'ok');

        // A second start replaces the unconfirmed secret.
        $again = (string) $this->settings('POST', 'settings/totp', ['currentPassword' => 'secret'])->json('secret');
        $this->assertNotSame($secret, $again);
    }

    public function test_start_needs_the_account_password(): void
    {
        $plain = app(AppPasswordService::class)->create('bob', 'Phone')['password'];

        $this->settings('POST', 'settings/totp', [])->assertStatus(400);
        $this->settings('POST', 'settings/totp', ['currentPassword' => 'wrong'])
            ->assertForbidden()->assertJsonPath('code', 'current_password_invalid');
        $this->settings('POST', 'settings/totp', ['currentPassword' => $plain])
            ->assertForbidden()->assertJsonPath('code', 'current_password_invalid');
        $this->assertSame(0, UserMfa::query()->count());
    }

    public function test_start_refused_while_enabled(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $before = UserMfa::query()->where('username', 'bob')->toBase()->first();

        $response = $this->settings('POST', 'settings/totp', ['currentPassword' => 'secret'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'mfa_already_enabled');

        $this->assertArrayNotHasKey('secret', (array) $response->json());
        $this->assertStringNotContainsString($secret, (string) $response->getContent());
        $this->assertEquals($before, UserMfa::query()->where('username', 'bob')->toBase()->first());
        $this->settings('POST', 'settings/totp/confirmation', ['currentPassword' => 'secret', 'code' => $this->code($secret, 1)])
            ->assertStatus(409);
    }

    public function test_confirm_turns_it_on_with_recovery_codes_and_ends_other_sessions(): void
    {
        $other = app(AuthTokenService::class)->issueForUsername('bob');
        $secret = (string) $this->settings('POST', 'settings/totp', ['currentPassword' => 'secret'])->json('secret');

        $response = $this->settings('POST', 'settings/totp/confirmation', ['currentPassword' => 'secret', 'code' => $this->code($secret)])
            ->assertOk();

        $codes = (array) $response->json('recovery_codes');
        $this->assertCount(10, $codes);
        $this->assertSame(10, MfaRecoveryCode::query()->where('username', 'bob')->whereNull('used_at')->count());
        $this->postRefresh($other['refresh_token'])->assertUnauthorized();
        // #2315: the other session's access token is refused at once, not at expiry.
        $this->withBearer($other['access_token'])->getJson('/api/v1/me')->assertUnauthorized();
        $this->signInWithPassword('bob')->assertJsonPath('status', 'mfa_required');
        // The confirming code's step is used: it cannot sign in.
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($secret)])->assertStatus(401);
        $this->nextStep();
        $signedIn = $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($secret)])->assertOk();
        $this->withBearer((string) $signedIn->json('access_token'))->getJson('/api/v1/me')->assertOk();
    }

    public function test_confirm_needs_password_code_and_a_started_setup(): void
    {
        $this->settings('POST', 'settings/totp/confirmation', ['currentPassword' => 'secret', 'code' => '123456'])
            ->assertStatus(400)->assertJsonPath('code', 'mfa_setup_missing');

        $secret = (string) $this->settings('POST', 'settings/totp', ['currentPassword' => 'secret'])->json('secret');
        $this->settings('POST', 'settings/totp/confirmation', ['currentPassword' => 'secret'])->assertStatus(400);
        $this->settings('POST', 'settings/totp/confirmation', ['currentPassword' => 'wrong', 'code' => $this->code($secret)])
            ->assertForbidden()->assertJsonPath('code', 'current_password_invalid');
        $this->settings('POST', 'settings/totp/confirmation', ['currentPassword' => 'secret', 'code' => $this->code($secret, 3)])
            ->assertForbidden()->assertJsonPath('code', 'mfa_code_invalid');
        $this->assertNull(UserMfa::query()->where('username', 'bob')->value('enabled_at'));
        $this->settings('GET', 'me')->assertJsonPath('mfa.enabled', false);
    }

    public function test_disable_needs_a_current_code(): void
    {
        $this->settings('DELETE', 'settings/totp', ['code' => '123456'])
            ->assertStatus(409)->assertJsonPath('code', 'mfa_not_enabled');

        $turnedOn = $this->turnOnMfa('bob');
        $this->settings('DELETE', 'settings/totp', [])->assertStatus(400);
        $this->settings('DELETE', 'settings/totp', ['code' => $this->code($turnedOn['secret'], 3)])
            ->assertForbidden()->assertJsonPath('code', 'mfa_code_invalid');
        // A recovery code is not a current code.
        $this->settings('DELETE', 'settings/totp', ['code' => $turnedOn['recovery_codes'][0]])->assertForbidden();

        $other = app(AuthTokenService::class)->issueForUsername('bob');
        $this->settings('DELETE', 'settings/totp', ['code' => $this->code($turnedOn['secret'])])->assertOk()->assertJsonPath('ok', true);

        // Turning it off ends no other session.
        $this->postRefresh($other['refresh_token'])->assertOk();

        $this->assertSame(0, UserMfa::query()->count());
        $this->assertSame(0, MfaRecoveryCode::query()->count());
        $this->signInWithPassword('bob')->assertJsonPath('status', 'ok');
        $this->dav('bob', 'secret')->assertStatus(207);
    }

    public function test_new_recovery_codes_replace_the_old_set(): void
    {
        $turnedOn = $this->turnOnMfa('bob');

        $this->settings('POST', 'settings/totp/recovery-codes', ['code' => $this->code($turnedOn['secret'], 3)])->assertForbidden();
        $codes = (array) $this->settings('POST', 'settings/totp/recovery-codes', ['code' => $this->code($turnedOn['secret'])])
            ->assertOk()
            ->json('recovery_codes');

        $this->assertCount(10, $codes);
        $this->assertSame([], array_intersect($codes, $turnedOn['recovery_codes']));
        $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => $turnedOn['recovery_codes'][0]])->assertStatus(401);
        $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => (string) $codes[0]])
            ->assertOk()->assertJsonPath('status', 'mfa_replace_required');
    }

    public function test_wrong_codes_in_settings_hit_the_limits(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];

        $statuses = [];
        for ($i = 0; $i < LoginRateLimiter::USER_IP_LIMIT + 1; $i++) {
            $statuses[] = $this->settings('DELETE', 'settings/totp', ['code' => $this->code($secret, 3)])->status();
        }

        $this->assertSame(array_merge(array_fill(0, LoginRateLimiter::USER_IP_LIMIT, 403), [429]), $statuses);
        $this->settings('DELETE', 'settings/totp', ['code' => $this->code($secret)])
            ->assertStatus(429)
            ->assertHeader('Retry-After');
        $this->assertSame(1, UserMfa::query()->count());
    }

    // ---- Creating an app password with two-factor on ----------------------

    public function test_app_password_create_takes_a_current_code_when_two_factor_is_on(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];

        $created = $this->settings('POST', 'settings/app-passwords', ['name' => 'Phone', 'code' => $this->code($secret)])
            ->assertCreated();

        $this->assertMatchesRegularExpression('/^[a-z]{16}$/', (string) $created->json('password'));
        $this->dav('bob', (string) $created->json('password'))->assertStatus(207);
        // The code's step is used now.
        $this->assertSame(intdiv(Carbon::now()->getTimestamp(), 30), UserMfa::query()->where('username', 'bob')->value('last_used_step'));
    }

    public function test_app_password_create_refuses_the_password_when_two_factor_is_on(): void
    {
        $this->turnOnMfa('bob');

        $this->settings('POST', 'settings/app-passwords', ['name' => 'Phone', 'currentPassword' => 'secret'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'mfa_code_required');
        $this->assertSame(0, AppPassword::query()->where('username', 'bob')->count());
    }

    public function test_app_password_create_refuses_a_replayed_or_recovery_code(): void
    {
        $turnedOn = $this->turnOnMfa('bob');
        $code = $this->code($turnedOn['secret']);
        $this->settings('POST', 'settings/app-passwords', ['name' => 'One', 'code' => $code])->assertCreated();

        $this->settings('POST', 'settings/app-passwords', ['name' => 'Two', 'code' => $code])
            ->assertForbidden()
            ->assertJsonPath('code', 'mfa_code_invalid');
        $this->settings('POST', 'settings/app-passwords', ['name' => 'Two', 'code' => $turnedOn['recovery_codes'][0]])
            ->assertForbidden();
        $this->assertSame(1, AppPassword::query()->where('username', 'bob')->count());
        $this->assertSame(10, MfaRecoveryCode::query()->where('username', 'bob')->whereNull('used_at')->count());
    }

    public function test_a_replayed_code_is_refused_on_every_code_route_without_counting(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $code = $this->code($secret);
        $this->settings('POST', 'settings/app-passwords', ['name' => 'One', 'code' => $code])->assertCreated();

        // More than the sign-in limit (and the per-user lock) would allow if these counted.
        for ($i = 0; $i < LoginRateLimiter::USER_IP_LIMIT + 3; $i++) {
            $this->settings('POST', 'settings/app-passwords', ['name' => 'Two', 'code' => $code])
                ->assertForbidden()->assertJsonPath('code', 'mfa_code_invalid');
            $this->settings('POST', 'settings/totp/recovery-codes', ['code' => $code])
                ->assertForbidden()->assertJsonPath('code', 'mfa_code_invalid');
            $this->settings('DELETE', 'settings/totp', ['code' => $code])
                ->assertForbidden()->assertJsonPath('code', 'mfa_code_invalid');
        }
        $this->assertSame(1, UserMfa::query()->count());

        $this->nextStep();
        $this->settings('DELETE', 'settings/totp', ['code' => $this->code($secret)])->assertOk();
    }

    public function test_app_password_create_wrong_codes_count_on_the_limits(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];

        $statuses = [];
        for ($i = 0; $i < LoginRateLimiter::USER_IP_LIMIT + 1; $i++) {
            $statuses[] = $this->settings('POST', 'settings/app-passwords', ['name' => 'Phone', 'code' => $this->code($secret, 3)])->status();
        }

        $this->assertSame(array_merge(array_fill(0, LoginRateLimiter::USER_IP_LIMIT, 403), [429]), $statuses);
        // The same counter as the other code routes: turning two-factor off is limited too.
        $this->settings('DELETE', 'settings/totp', ['code' => $this->code($secret)])->assertStatus(429)->assertHeader('Retry-After');
        $this->assertSame(0, AppPassword::query()->where('username', 'bob')->count());
    }

    public function test_app_password_create_without_two_factor_still_takes_the_password(): void
    {
        $this->settings('POST', 'settings/app-passwords', ['name' => 'Phone', 'code' => '123456'])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
        $this->settings('POST', 'settings/app-passwords', ['name' => 'Phone', 'currentPassword' => 'wrong'])
            ->assertForbidden()
            ->assertJsonPath('code', 'current_password_invalid');
        $this->settings('POST', 'settings/app-passwords', ['name' => 'Phone', 'currentPassword' => 'secret'])
            ->assertCreated();
    }

    public function test_status_on_me_and_settings_state(): void
    {
        $this->settings('GET', 'me')->assertJsonPath('mfa', ['enabled' => false, 'recoveryCodesRemaining' => 0]);
        $this->settings('GET', 'settings/state')->assertJsonPath('mfa', ['enabled' => false, 'recoveryCodesRemaining' => 0]);

        $turnedOn = $this->turnOnMfa('bob');
        $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => $turnedOn['recovery_codes'][0]]);
        $this->token = app(AuthTokenService::class)->issueForUsername('bob')['access_token'];

        $this->settings('GET', 'me')->assertJsonPath('mfa', ['enabled' => true, 'recoveryCodesRemaining' => 9]);
        $this->settings('GET', 'settings/state')->assertJsonPath('mfa', ['enabled' => true, 'recoveryCodesRemaining' => 9]);
    }

    public function test_settings_routes_need_a_signed_in_account(): void
    {
        $this->postJson('/api/v1/settings/totp', ['currentPassword' => 'secret'])->assertUnauthorized();
        $this->postJson('/api/v1/settings/totp/confirmation', ['currentPassword' => 'secret', 'code' => '123456'])->assertUnauthorized();
        $this->deleteJson('/api/v1/settings/totp', ['code' => '123456'])->assertUnauthorized();
        $this->postJson('/api/v1/settings/totp/recovery-codes', ['code' => '123456'])->assertUnauthorized();
    }

    /**
     * Turning two-factor on signs out everywhere, which refuses access tokens
     * issued before it (#2315). Sign bob in again, as the app does.
     *
     * @return array{secret: string, recovery_codes: list<string>}
     */
    protected function turnOnMfa(string $username): array
    {
        $result = $this->turnOnMfaForUser($username);
        if ($username === 'bob') {
            $this->token = app(AuthTokenService::class)->issueForUsername('bob')['access_token'];
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function settings(string $method, string $path, array $body = []): TestResponse
    {
        return $this->withBearer($this->token)
            ->withServerVariables(['REMOTE_ADDR' => '203.0.113.30'])
            ->json($method, '/api/v1/'.$path, $body);
    }
}
