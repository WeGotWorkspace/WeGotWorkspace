<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\AppSetting;
use App\Models\AuthChallenge;
use App\Models\User;
use App\Models\UserMfa;
use App\Services\Auth\AppPasswordService;
use App\Services\Auth\RecoveryCodeService;
use App\Services\Auth\SabreCredentialValidator;
use App\Services\Auth\TotpService;
use App\Services\Auth\UserMfaService;
use App\Services\Mcp\McpScopes;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;

final class MfaLoginTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_password_only_user_still_receives_both_tokens(): void
    {
        $response = $this->login();

        $response->assertOk();
        $response->assertJsonPath('status', 'ok');
        $response->assertJsonStructure(['access_token', 'refresh_token']);
    }

    public function test_totp_login_issues_tokens_once_and_rejects_replay_and_outside_window(): void
    {
        $secret = $this->enableTotp();
        $challenge = (string) $this->login()
            ->assertJsonPath('status', 'mfa_required')
            ->assertJsonPath('client', 'spa')
            ->json('challenge');
        $this->assertArrayNotHasKey('access_token', $this->login()->json());

        $code = $this->otp($secret);
        $ok = $this->verify($challenge, $code);
        $ok->assertOk();
        $ok->assertJsonPath('status', 'ok');
        $this->assertNotSame('', (string) $ok->json('access_token'));

        $second = (string) $this->login()->json('challenge');
        $replay = $this->verify($second, $code);
        $replay->assertUnauthorized();
        $replay->assertJsonPath('code', 'totp_step_reused');
        $replay->assertJsonPath('error', 'Wait for the next code.');

        $third = (string) $this->login()->json('challenge');
        $stale = $this->verify($third, $this->otp($secret, -2));
        $stale->assertUnauthorized();
        $this->assertNotSame('totp_step_reused', $stale->json('code'));
    }

    public function test_sixth_code_on_one_challenge_is_throttled(): void
    {
        $secret = $this->enableTotp();
        $challenge = (string) $this->login()->json('challenge');
        $wrong = $this->wrongCode($secret);

        for ($i = 0; $i < 5; $i++) {
            $this->verify($challenge, $wrong)->assertUnauthorized();
        }

        $this->verify($challenge, $wrong)->assertStatus(429)->assertJsonPath('code', 'throttled');
    }

    public function test_six_ips_times_two_codes_then_a_new_ip_are_throttled(): void
    {
        $secret = $this->enableTotp();
        $wrong = $this->wrongCode($secret);
        $last = null;

        for ($ip = 1; $ip <= 5; $ip++) {
            $challenge = (string) $this->login('198.51.100.'.$ip)->json('challenge');
            $last = $this->verify($challenge, $wrong, '198.51.100.'.$ip);
            $last = $this->verify($challenge, $wrong, '198.51.100.'.$ip);
        }

        $last?->assertStatus(429);
        $this->login('203.0.113.50')->assertStatus(429)->assertJsonPath('code', 'throttled');
    }

    public function test_tripping_the_counter_rejects_an_older_challenge(): void
    {
        $secret = $this->enableTotp();
        $wrong = $this->wrongCode($secret);
        $challenges = [];
        for ($i = 0; $i < 3; $i++) {
            $challenges[] = (string) $this->login('203.0.113.'.(10 + $i))->json('challenge');
        }

        $plan = [4, 4, 3];
        foreach ($plan as $index => $times) {
            for ($n = 0; $n < $times; $n++) {
                $this->verify($challenges[$index], $wrong, '203.0.113.'.(20 + $index));
            }
        }

        $this->assertSame(0, AuthChallenge::query()->where('username', 'alice')->count());
        $this->verify($challenges[0], $this->otp($secret), '203.0.113.99')
            ->assertStatus(429)
            ->assertJsonPath('code', 'throttled');
    }

    public function test_totp_challenge_expires_at_five_minutes_and_setup_lasts_fifteen(): void
    {
        $secret = $this->enableTotp();
        Carbon::setTestNow(Carbon::parse('2026-09-29 12:00:00'));
        $challenge = (string) $this->login()->json('challenge');
        Carbon::setTestNow(Carbon::parse('2026-09-29 12:05:01'));
        $this->verify($challenge, $this->otp($secret))->assertUnauthorized();

        UserMfa::query()->where('username', 'alice')->delete();
        AppSetting::setValue('auth_mfa_required', true);
        Carbon::setTestNow(Carbon::parse('2026-09-29 13:00:00'));
        $setup = $this->login()->assertJsonPath('status', 'mfa_setup_required');
        $setupId = (string) $setup->json('challenge');
        Carbon::setTestNow(Carbon::parse('2026-09-29 13:06:00'));
        $this->postJson('/api/v1/auth/mfa-challenges/'.$setupId.'/totp', [
            'password' => 'secret',
        ])->assertOk();
        Carbon::setTestNow(Carbon::parse('2026-09-29 13:15:01'));
        $this->postJson('/api/v1/auth/mfa-challenges/'.$setupId.'/totp')->assertUnauthorized();
    }

    public function test_recovery_code_starts_replacement_and_cannot_be_reused(): void
    {
        $secret = $this->enableTotp();
        $codes = app(RecoveryCodeService::class)->replaceAll('alice');
        $challenge = (string) $this->login()->assertJsonPath('status', 'mfa_required')->json('challenge');

        $replace = $this->verify($challenge, $codes[0], recovery: true);
        $replace->assertOk();
        $replace->assertJsonPath('status', 'mfa_replace_required');
        $this->assertArrayNotHasKey('access_token', $replace->json());
        $this->assertSame($secret, UserMfa::query()->where('username', 'alice')->first()?->totp_secret);

        $this->verify($challenge, $codes[0], recovery: true)->assertUnauthorized();

        $first = $this->postJson('/api/v1/auth/mfa-challenges/'.$challenge.'/totp')->assertOk();
        $second = $this->postJson('/api/v1/auth/mfa-challenges/'.$challenge.'/totp')->assertOk();
        $this->assertSame($first->json('secret'), $second->json('secret'));
        $pending = (string) $first->json('secret');
        $this->assertNotSame($secret, $pending);

        $confirmed = $this->postJson('/api/v1/auth/mfa-challenges/'.$challenge.'/confirmation', [
            'code' => $this->otp($pending),
        ]);
        $confirmed->assertOk();
        $confirmed->assertJsonPath('status', 'ok');
        $this->assertNotSame('', (string) $confirmed->json('access_token'));
        $this->assertCount(10, $confirmed->json('recovery_codes'));
        $this->assertNotSame($secret, UserMfa::query()->where('username', 'alice')->first()?->totp_secret);
    }

    public function test_app_password_create_rejects_the_account_password_once_totp_is_on(): void
    {
        $token = $this->issueBearerToken();
        $this->enableTotp();

        $this->withBearer($token)->postJson('/api/v1/settings/app-passwords', [
            'name' => 'Phone',
            'password' => 'secret',
        ])->assertStatus(422)->assertJsonPath('code', 'mfa_code_required');

        $this->flushHeaders();
        $created = app(AppPasswordService::class)->create('alice', 'Phone');
        $validator = app(SabreCredentialValidator::class);
        $this->assertFalse($validator->validateProtocol('alice', 'secret', 'SabreDAV'));
        $this->assertTrue($validator->validateProtocol('alice', $created['password'], 'SabreDAV'));
    }

    public function test_enroll_confirmation_consumes_the_step(): void
    {
        $token = $this->issueBearerToken();
        $first = $this->withBearer($token)->postJson('/api/v1/settings/totp', [
            'password' => 'secret',
        ])->assertOk();
        $second = $this->withBearer($token)->postJson('/api/v1/settings/totp', [
            'password' => 'secret',
        ])->assertOk();
        $this->assertSame($first->json('secret'), $second->json('secret'));
        $secret = (string) $first->json('secret');
        $code = $this->otp($secret);

        $confirmed = $this->withBearer($token)->postJson('/api/v1/settings/totp/confirmation', [
            'code' => $code,
            'password' => 'secret',
        ])->assertOk()->assertJsonCount(10, 'recovery_codes');
        $fresh = (string) $confirmed->json('access_token');

        $this->flushHeaders();
        $this->withBearer($fresh)->postJson('/api/v1/settings/app-passwords', [
            'name' => 'Mail',
            'code' => $code,
        ])->assertUnauthorized()
            ->assertJsonPath('code', 'totp_step_reused')
            ->assertJsonPath('error', 'Wait for the next code.');

        Carbon::setTestNow(Carbon::now()->addSeconds(31));
        $this->withBearer($fresh)->deleteJson('/api/v1/settings/totp', [
            'code' => $this->otp($secret),
        ])->assertOk();
        $this->assertFalse(app(UserMfaService::class)->isEnabled('alice'));
    }

    public function test_provisioning_reports_dav_use_and_suggestion_snooze_hides_the_prompt(): void
    {
        $token = $this->issueBearerToken();
        $first = $this->withBearer($token)->postJson('/api/v1/settings/totp', ['password' => 'secret']);
        $first->assertOk();
        $first->assertJsonPath('dav_warning', false);

        User::query()->where('username', 'alice')->update(['dav_password_used_at' => Carbon::now()]);
        $second = $this->withBearer($token)->postJson('/api/v1/settings/totp', ['password' => 'secret']);
        $second->assertOk();
        $second->assertJsonPath('dav_warning', true);
        $second->assertJsonPath('secret', $first->json('secret'));

        $this->withBearer($token)->postJson('/api/v1/settings/totp/suggestion')->assertOk()
            ->assertJsonPath('suggest', false);
        $this->withBearer($token)->getJson('/api/v1/me')->assertOk()->assertJsonPath('mfa.suggest', false);
    }

    public function test_oauth_session_does_not_log_in_before_the_code(): void
    {
        $this->enableMcp();
        $this->enableTotp();
        $this->get('/oauth/session');

        $this->postJson('/oauth/session', [
            'username' => 'alice',
            'password' => 'secret',
        ])->assertOk()->assertJsonPath('status', 'mfa_required');

        $this->assertGuest('web');
    }

    public function test_oauth_session_signs_in_after_the_authenticator_code(): void
    {
        $this->enableMcp();
        $secret = $this->enableTotp();
        $user = User::query()->where('username', 'alice')->firstOrFail();
        $client = $this->mcpClient();
        $authorize = $this->authorizeUrl((string) $client->getKey());

        $guest = $this->get($authorize);
        $guest->assertRedirect();
        $sessionPage = $this->get((string) $guest->headers->get('Location'));
        $sessionPage->assertRedirect();
        $pwa = (string) $sessionPage->headers->get('Location');
        $query = [];
        parse_str((string) parse_url($pwa, PHP_URL_QUERY), $query);
        $this->assertNotSame('', $query['intent'] ?? '');

        $password = $this->postJson('/oauth/session', [
            'username' => 'alice',
            'password' => 'secret',
            'intent' => $query['intent'],
        ])->assertOk()
            ->assertJsonPath('status', 'mfa_required')
            ->assertJsonPath('client', 'oauth');
        $this->assertGuest('web');
        $challenge = (string) $password->json('challenge');

        $this->postJson('/api/v1/auth/mfa-challenges/'.$challenge.'/verification', [
            'code' => $this->otp($secret),
        ])->assertStatus(409);
        $this->assertGuest('web');

        $this->postJson('/oauth/session', [
            'challenge' => $challenge,
            'code' => $this->otp($secret),
            'intent' => $query['intent'],
        ])->assertOk()->assertJsonPath('status', 'ok');
        $this->assertAuthenticatedAs($user, 'web');

        $this->get($query['return'])
            ->assertOk()
            ->assertSee('Connect assistant', false)
            ->assertDontSee('Sign in to connect an assistant', false);
    }

    public function test_correct_code_is_rejected_after_five_failures_on_one_challenge(): void
    {
        $secret = $this->enableTotp();
        $challenge = (string) $this->login()->json('challenge');
        $wrong = $this->wrongCode($secret);

        for ($i = 0; $i < 5; $i++) {
            $this->verify($challenge, $wrong)->assertUnauthorized();
        }

        $this->verify($challenge, $this->otp($secret))
            ->assertStatus(429)
            ->assertJsonPath('code', 'throttled');
    }

    public function test_correct_code_is_rejected_when_the_ip_limiter_already_tripped(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);

        $secret = $this->enableTotp();
        $ip = '203.0.113.77';
        $challenge = (string) $this->login($ip)->json('challenge');
        for ($i = 0; $i < 7; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => $ip])->postJson('/api/v1/auth/token', [
                'username' => 'alice',
                'password' => 'not-the-password',
            ])->assertUnauthorized();
        }

        $this->verify($challenge, $this->otp($secret), $ip)
            ->assertStatus(429)
            ->assertJsonPath('code', 'throttled');
    }

    public function test_reauth_locks_after_ten_wrong_codes_and_keeps_a_correct_code_out(): void
    {
        $token = $this->issueBearerToken();
        $secret = $this->enableTotp();
        $wrong = $this->wrongCode($secret);

        for ($i = 0; $i < 9; $i++) {
            $this->withBearer($token)->postJson('/api/v1/settings/totp/recovery-codes', [
                'code' => $wrong,
            ])->assertUnauthorized()->assertJsonPath('code', 'unauthorized');
        }

        $this->withBearer($token)->postJson('/api/v1/settings/totp/recovery-codes', [
            'code' => $wrong,
        ])->assertStatus(429)->assertJsonPath('code', 'throttled');

        $this->withBearer($token)->postJson('/api/v1/settings/totp/recovery-codes', [
            'code' => $this->otp($secret),
        ])->assertStatus(429)->assertJsonPath('code', 'throttled');
    }

    public function test_setup_confirmation_does_not_overwrite_an_active_authenticator(): void
    {
        $token = $this->issueBearerToken();
        $secret = (string) $this->withBearer($token)->postJson('/api/v1/settings/totp', [
            'password' => 'secret',
        ])->json('secret');
        $this->withBearer($token)->postJson('/api/v1/settings/totp/confirmation', [
            'code' => $this->otp($secret),
            'password' => 'secret',
        ])->assertOk();

        $attacker = app(TotpService::class)->generateSecret();
        $id = bin2hex(random_bytes(32));
        AuthChallenge::query()->create([
            'id_hash' => hash('sha256', $id),
            'username' => 'alice',
            'kind' => 'totp_setup',
            'client' => 'spa',
            'pending_secret' => $attacker,
            'attempts' => 0,
            'expires_at' => Carbon::now()->addMinutes(15),
            'created_at' => Carbon::now(),
        ]);

        $this->postJson('/api/v1/auth/mfa-challenges/'.$id.'/confirmation', [
            'code' => $this->otp($attacker),
            'password' => 'secret',
        ])->assertStatus(409);

        $this->assertSame($secret, UserMfa::query()->where('username', 'alice')->firstOrFail()->totp_secret);
    }

    public function test_password_reauth_locks_after_the_sign_in_limiter(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);

        $token = $this->issueBearerToken();
        for ($i = 0; $i < 8; $i++) {
            $this->withBearer($token)->postJson('/api/v1/settings/totp', [
                'password' => 'wrong-password',
            ])->assertUnauthorized();
        }

        $this->withBearer($token)->postJson('/api/v1/settings/totp', [
            'password' => 'secret',
        ])->assertStatus(429)->assertJsonPath('code', 'throttled');
    }

    public function test_successful_password_reauths_do_not_trip_the_sign_in_limiter(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);

        $token = $this->issueBearerToken();
        for ($i = 0; $i < 9; $i++) {
            $this->withBearer($token)->postJson('/api/v1/settings/totp', [
                'password' => 'secret',
            ])->assertOk();
        }
    }

    public function test_enrollment_requires_the_account_password_before_the_secret(): void
    {
        $token = $this->issueBearerToken();

        $this->withBearer($token)->postJson('/api/v1/settings/totp')->assertStatus(422);

        $this->withBearer($token)->postJson('/api/v1/settings/totp', [
            'password' => 'wrong-password',
        ])->assertUnauthorized();
    }

    private function enableTotp(): string
    {
        $secret = app(TotpService::class)->generateSecret();
        UserMfa::query()->create([
            'username' => 'alice',
            'totp_secret' => $secret,
            'enabled_at' => Carbon::now(),
        ]);

        return $secret;
    }

    private function login(string $ip = '203.0.113.10'): TestResponse
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $ip])->postJson('/api/v1/auth/token', [
            'username' => 'alice',
            'password' => 'secret',
        ]);
    }

    private function verify(string $challenge, string $code, string $ip = '203.0.113.10', bool $recovery = false): TestResponse
    {
        $body = $recovery ? ['recovery_code' => $code] : ['code' => $code];

        return $this->withServerVariables(['REMOTE_ADDR' => $ip])->postJson(
            '/api/v1/auth/mfa-challenges/'.$challenge.'/verification',
            $body,
        );
    }

    private function otp(string $secret, int $offset = 0): string
    {
        $engine = new Google2FA;
        $step = (int) floor(Carbon::now()->getTimestamp() / 30) + $offset;

        return $engine->oathTotp($secret, $step);
    }

    private function wrongCode(string $secret): string
    {
        $current = $this->otp($secret);

        return $current === '000000' ? '111111' : '000000';
    }

    private function authorizeUrl(string $clientId): string
    {
        $verifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');

        return '/oauth/authorize?'.http_build_query([
            'client_id' => $clientId,
            'redirect_uri' => 'https://claude.ai/callback',
            'response_type' => 'code',
            'scope' => McpScopes::DRIVE_READ,
            'state' => 'state-1',
            'code_challenge' => $challenge,
            'code_challenge_method' => 'S256',
        ]);
    }
}
