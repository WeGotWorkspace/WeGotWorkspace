<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Dav\Auth\VerifiedPasswordMemory;
use App\Exceptions\ApiHttpException;
use App\Models\ApiPasswordResetToken;
use App\Models\AuthChallenge;
use App\Models\MfaRecoveryCode;
use App\Models\User;
use App\Models\UserMfa;
use App\Services\Auth\AppPasswordService;
use App\Services\Auth\AuthTokenService;
use App\Services\Auth\LoginRateLimiter;
use App\Services\Auth\Mfa\AuthChallengeService;
use App\Services\Auth\Mfa\MfaCodeLimiter;
use App\Services\Auth\PasswordRecoveryService;
use App\Services\Auth\UserSessionRevoker;
use App\Services\Mcp\ConsentIntent;
use Illuminate\Cache\Events\KeyWritten;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Support\ConfiguresMcp;
use Tests\Support\TwoFactorTestHelpers;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Signing in with two-factor on (#2273): the challenge after the password, the
 * code and recovery-code steps, replacement, and every password caller that
 * must refuse the password alone.
 */
final class MfaLoginTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use TwoFactorTestHelpers;

    /** @var list<string|null> */
    private array $rememberedIn = [];

    protected function setUp(): void
    {
        parent::setUp();
        Event::listen(KeyWritten::class, function (KeyWritten $event): void {
            if (str_starts_with($event->key, 'dav-basic-verified:')) {
                $this->rememberedIn[] = $event->storeName;
            }
        });
        $this->setUpTwoFactorWorld();
    }

    protected function tearDown(): void
    {
        $this->tearDownTwoFactorWorld();
        parent::tearDown();
    }

    // ---- Password step -----------------------------------------------------

    public function test_without_two_factor_the_password_still_signs_in(): void
    {
        $response = $this->signInWithPassword('bob')->assertOk();

        $response->assertJsonPath('status', 'ok');
        $this->assertNotSame('', (string) $response->json('access_token'));
        $this->refreshCookieValue($response);
    }

    public function test_the_password_alone_returns_a_challenge_and_no_tokens(): void
    {
        $this->turnOnMfa('bob');

        $response = $this->signInWithPassword('bob')->assertOk();

        $response->assertExactJson([
            'status' => 'mfa_required',
            'challenge' => $response->json('challenge'),
            'client' => 'spa',
        ]);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', (string) $response->json('challenge'));
        $this->assertNull($response->getCookie('wgw_refresh', false));
        $this->assertSame([], $response->headers->getCookies());
        // Only the hash of the id is stored.
        $this->assertSame(
            hash('sha256', (string) $response->json('challenge')),
            AuthChallenge::query()->where('username', 'bob')->value('id_hash'),
        );
    }

    public function test_a_wrong_password_never_reaches_the_code_step(): void
    {
        $this->turnOnMfa('bob');

        $this->signInWithPassword('bob', 'wrong')->assertUnauthorized();
        $this->assertSame(0, $this->openChallenges('bob'));
    }

    // ---- Code step ---------------------------------------------------------

    public function test_a_code_completes_the_sign_in_with_tokens_and_the_refresh_cookie(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $challenge = $this->challengeFor('bob');

        $response = $this->verifyChallenge($challenge, ['code' => $this->code($secret)])->assertOk();

        $response->assertJsonPath('status', 'ok');
        $this->assertNotSame('', (string) $response->json('access_token'));
        $this->refreshCookieValue($response);
        $this->withBearer((string) $response->json('access_token'))->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('username', 'bob')
            ->assertJsonPath('mfa.enabled', true)
            ->assertJsonPath('mfa.recoveryCodesRemaining', 10);
    }

    public function test_a_code_typed_with_a_space_and_the_previous_step_work(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $code = $this->code($secret);

        $this->verifyChallenge($this->challengeFor('bob'), ['code' => substr($code, 0, 3).' '.substr($code, 3)])
            ->assertOk()->assertJsonPath('status', 'ok');

        // One step of clock drift either way is accepted, if newer than the last used.
        $this->nextStep(2);
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($secret, -1)])
            ->assertOk()->assertJsonPath('status', 'ok');
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($secret, -3)])
            ->assertStatus(401)->assertJsonPath('code', 'mfa_code_invalid');
    }

    public function test_a_wrong_code_is_refused_and_the_challenge_stays_open(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $challenge = $this->challengeFor('bob');

        $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])
            ->assertStatus(401)
            ->assertJsonPath('code', 'mfa_code_invalid');
        $this->verifyChallenge($challenge, ['code' => $this->code($secret)])->assertOk();
    }

    public function test_a_replayed_code_of_the_same_step_is_refused(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $code = $this->code($secret);
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $code])->assertOk();

        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $code])
            ->assertStatus(401)
            ->assertJsonPath('code', 'mfa_code_invalid');
        $this->assertSame(
            intdiv(Carbon::now()->getTimestamp(), 30),
            UserMfa::query()->where('username', 'bob')->value('last_used_step'),
        );
    }

    public function test_a_replayed_code_is_refused_without_using_up_an_attempt(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $code = $this->code($secret);
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $code])->assertOk();

        // More tries than a challenge (5), the per-user lock (10) or the sign-in limit allow.
        $challenge = $this->challengeFor('bob');
        for ($i = 0; $i < 15; $i++) {
            $this->verifyChallenge($challenge, ['code' => $code])
                ->assertStatus(401)
                ->assertJsonPath('code', 'mfa_code_invalid');
        }
        $this->assertSame(0, (int) AuthChallenge::query()->where('id_hash', hash('sha256', $challenge))->value('attempts'));

        // Nothing was counted anywhere, so the next step's code still signs in.
        $this->nextStep();
        $this->verifyChallenge($challenge, ['code' => $this->code($secret)])->assertOk();
    }

    public function test_a_wrong_code_still_uses_up_an_attempt(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $code = $this->code($secret);
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $code])->assertOk();
        $challenge = $this->challengeFor('bob');

        $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])->assertStatus(401);
        $this->assertSame(1, (int) AuthChallenge::query()->where('id_hash', hash('sha256', $challenge))->value('attempts'));
        // A code of a step that was never accepted is no replay, even next to a spent one.
        $this->verifyChallenge($challenge, ['code' => $this->code($secret, 1)])->assertOk();
    }

    public function test_a_challenge_is_single_use(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $challenge = $this->challengeFor('bob');
        $this->verifyChallenge($challenge, ['code' => $this->code($secret)])->assertOk();

        $this->nextStep();
        $this->verifyChallenge($challenge, ['code' => $this->code($secret)])
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_a_challenge_expires_after_ten_minutes(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $challenge = $this->challengeFor('bob');

        Carbon::setTestNow(Carbon::now()->addSeconds(AuthChallengeService::TTL_SECONDS));
        $this->verifyChallenge($challenge, ['code' => $this->code($secret)])->assertNotFound();
    }

    public function test_unknown_and_malformed_challenges_are_not_found(): void
    {
        $this->turnOnMfa('bob');

        $this->verifyChallenge(str_repeat('a', 64), ['code' => '123456'])->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->verifyChallenge('nothex', ['code' => '123456'])->assertNotFound();
    }

    public function test_challenge_client_is_enforced(): void
    {
        $this->enableMcp();
        $secret = $this->turnOnMfa('bob')['secret'];

        // An spa challenge does not complete on oauth/session …
        $spa = $this->challengeFor('bob');
        $this->postJson('/oauth/session', ['challenge' => $spa, 'code' => $this->code($secret), 'intent' => $this->intent()])->assertNotFound();
        $this->assertGuest('web');

        // … and an oauth challenge does not complete on the spa route.
        $oauth = (string) $this->postJson('/oauth/session', ['username' => 'bob', 'password' => 'secret', 'intent' => $this->intent()])
            ->assertOk()
            ->assertJsonPath('client', 'oauth')
            ->json('challenge');
        $this->verifyChallenge($oauth, ['code' => $this->code($secret)])->assertNotFound();

        // Both still work where they belong.
        $this->verifyChallenge($spa, ['code' => $this->code($secret)])->assertOk();
    }

    public function test_exactly_one_of_code_and_recovery_code(): void
    {
        $recovery = $this->turnOnMfa('bob')['recovery_codes'][0];
        $challenge = $this->challengeFor('bob');

        $this->verifyChallenge($challenge, [])->assertStatus(400);
        $this->verifyChallenge($challenge, ['code' => '123456', 'recovery_code' => $recovery])->assertStatus(400);
        $this->verifyChallenge($challenge, ['code' => ['123456']])->assertStatus(400);
        $this->assertSame(10, MfaRecoveryCode::query()->where('username', 'bob')->whereNull('used_at')->count());
    }

    public function test_a_disabled_user_cannot_finish_the_code_step(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $challenge = $this->challengeFor('bob');
        User::query()->where('username', 'bob')->update(['enabled' => false]);

        $this->verifyChallenge($challenge, ['code' => $this->code($secret)])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'unauthorized');
        $this->assertSame(0, $this->openChallenges('bob'));
    }

    // ---- Limits ------------------------------------------------------------

    public function test_sixth_code_on_one_challenge_is_refused(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $challenge = $this->challengeFor('bob');

        for ($i = 0; $i < AuthChallengeService::MAX_ATTEMPTS; $i++) {
            $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])->assertStatus(401);
        }

        // The right code on the sixth try: the challenge is gone.
        $this->verifyChallenge($challenge, ['code' => $this->code($secret)])->assertNotFound();
    }

    public function test_eleventh_failure_across_challenges_then_correct_code_is_refused(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];

        // Two wrong codes per challenge; the correct password in between resets
        // the sign-in limiter, never the per-user code counter.
        $statuses = [];
        for ($round = 0; $round < 5; $round++) {
            $challenge = $this->challengeFor('bob');
            for ($i = 0; $i < 2; $i++) {
                $statuses[] = $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])->status();
            }
        }
        $this->assertSame([401, 401, 401, 401, 401, 401, 401, 401, 401, 429], $statuses);
        $this->assertSame(0, $this->openChallenges('bob'));

        $challenge = $this->challengeFor('bob');
        $locked = $this->verifyChallenge($challenge, ['code' => $this->code($secret)]);
        $locked->assertStatus(429)->assertJsonPath('code', 'throttled');
        $this->assertGreaterThan(0, (int) $locked->headers->get('Retry-After'));

        // A recovery code is refused the same way, and is not spent.
        $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => '0000-0000-0000-0000'])->assertStatus(429);

        // After the hour it works again.
        Carbon::setTestNow(Carbon::now()->addSeconds(MfaCodeLimiter::DECAY_SECONDS + 1));
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($secret)])->assertOk();
    }

    public function test_the_lock_lasts_an_hour_from_the_tenth_failure(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $challenge = $this->challengeFor('bob');
        $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])->assertStatus(401);

        // Eight more just before the counter's first-hit timer runs out.
        Carbon::setTestNow(Carbon::now()->addMinutes(59));
        for ($round = 0; $round < 2; $round++) {
            $challenge = $this->challengeFor('bob');
            for ($i = 0; $i < 4; $i++) {
                $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])->assertStatus(401);
            }
        }
        $locked = $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->wrongCode($secret)]);
        $locked->assertStatus(429);
        $this->assertGreaterThan(3500, (int) $locked->headers->get('Retry-After'));

        // Past the hour after the first failure: still locked.
        Carbon::setTestNow(Carbon::now()->addMinutes(2));
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($secret)])->assertStatus(429);

        // An hour after the tenth: open again.
        Carbon::setTestNow(Carbon::now()->addMinutes(59));
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($secret)])->assertOk();
    }

    public function test_a_password_reset_by_email_leaves_two_factor_on(): void
    {
        $this->turnOnMfa('bob');
        $token = bin2hex(random_bytes(32));
        ApiPasswordResetToken::query()->create([
            'token_hash' => hash('sha256', $token),
            'username' => 'bob',
            'expires_at' => time() + PasswordRecoveryService::TOKEN_TTL_SECONDS,
        ]);

        $this->postJson('/api/v1/auth/password-resets/'.$token, ['password' => 'newpassword12'])
            ->assertOk()
            ->assertJsonMissingPath('access_token');

        $this->signInWithPassword('bob', 'newpassword12')->assertOk()->assertJsonPath('status', 'mfa_required');
        $this->dav('bob', 'newpassword12')->assertStatus(401);
    }

    public function test_second_request_after_limit_is_refused_before_the_code_is_read(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        // Another user's lock does not affect bob.
        for ($i = 0; $i < MfaCodeLimiter::LIMIT - 1; $i++) {
            app(MfaCodeLimiter::class)->recordFailure('carol');
        }
        try {
            app(MfaCodeLimiter::class)->recordFailure('carol');
            $this->fail('The tenth failure locks carol.');
        } catch (ApiHttpException $e) {
            $this->assertSame(429, $e->apiErrorStatus());
        }

        $challenge = $this->challengeFor('bob');
        for ($i = 0; $i < 4; $i++) {
            $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])->assertStatus(401);
        }
        $challenge = $this->challengeFor('bob');
        for ($i = 0; $i < 4; $i++) {
            $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])->assertStatus(401);
        }
        $challenge = $this->challengeFor('bob');
        $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])->assertStatus(401);
        $this->verifyChallenge($challenge, ['code' => $this->wrongCode($secret)])->assertStatus(429);

        $challenge = $this->challengeFor('bob');
        $first = $this->verifyChallenge($challenge, ['code' => $this->code($secret)])->assertStatus(429);
        $second = $this->verifyChallenge($challenge, ['code' => $this->code($secret)])->assertStatus(429);
        $this->assertNotNull($first->headers->get('Retry-After'));
        $this->assertNotNull($second->headers->get('Retry-After'));
    }

    public function test_wrong_codes_count_on_the_sign_in_limiter_of_the_address(): void
    {
        $secret = $this->turnOnMfa('bob')['secret'];
        $challenge = $this->challengeFor('bob');

        // Unknown challenge ids count on the address, so guessing ids is capped.
        for ($i = 0; $i < 40; $i++) {
            $this->verifyChallenge(bin2hex(random_bytes(32)), ['code' => '123456'], '198.51.100.7')->assertNotFound();
        }
        $this->verifyChallenge($challenge, ['code' => $this->code($secret)], '198.51.100.7')
            ->assertStatus(429)
            ->assertHeader('Retry-After');

        // Another address is not affected.
        $this->verifyChallenge($challenge, ['code' => $this->code($secret)])->assertOk();
    }

    // ---- Recovery codes and replacement -----------------------------------

    public function test_a_recovery_code_is_spent_and_asks_for_a_new_authenticator(): void
    {
        $turnedOn = $this->turnOnMfa('bob');
        $recovery = $turnedOn['recovery_codes'][3];

        // Upper case, no dashes, spaces: all the same code.
        $response = $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => strtoupper(str_replace('-', ' ', $recovery))])
            ->assertOk();

        $response->assertJsonPath('status', 'mfa_replace_required')->assertJsonPath('client', 'spa');
        $this->assertArrayNotHasKey('access_token', (array) $response->json());
        $this->assertSame([], $response->headers->getCookies());
        $newSecret = (string) $response->json('secret');
        $this->assertNotSame($turnedOn['secret'], $newSecret);
        $this->assertStringStartsWith('otpauth://totp/', (string) $response->json('otpauth_uri'));
        $this->assertStringContainsString('secret='.$newSecret, (string) $response->json('otpauth_uri'));

        // Spent: the same recovery code does not work again.
        $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => $recovery])
            ->assertStatus(401)
            ->assertJsonPath('code', 'mfa_code_invalid');
        // A replace challenge is not a login challenge.
        $this->verifyChallenge((string) $response->json('challenge'), ['code' => $this->code($newSecret)])->assertNotFound();
    }

    public function test_replacement_stores_the_new_secret_and_ends_every_session(): void
    {
        $turnedOn = $this->turnOnMfa('bob');
        $oldSession = app(AuthTokenService::class)->issueForUsername('bob');
        $replace = $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => $turnedOn['recovery_codes'][0]]);
        $newSecret = (string) $replace->json('secret');
        $challenge = (string) $replace->json('challenge');

        // A code of the old secret does not confirm the new one.
        $this->replaceWithChallenge($challenge, ['code' => $this->code($turnedOn['secret'], 1)])
            ->assertStatus(401)->assertJsonPath('code', 'mfa_code_invalid');
        $this->replaceWithChallenge($challenge, [])->assertStatus(400);

        $done = $this->replaceWithChallenge($challenge, ['code' => $this->code($newSecret)])->assertOk();

        $done->assertJsonPath('status', 'ok');
        $this->refreshCookieValue($done);
        $codes = (array) $done->json('recovery_codes');
        $this->assertCount(10, $codes);
        foreach ($codes as $code) {
            $this->assertMatchesRegularExpression('/^[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/', (string) $code);
        }
        // The old recovery codes and the old secret stop working.
        $this->assertSame(10, MfaRecoveryCode::query()->where('username', 'bob')->count());
        $this->nextStep();
        $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => $turnedOn['recovery_codes'][1]])->assertStatus(401);
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($turnedOn['secret'])])->assertStatus(401);
        // The new session works; the one from before does not.
        $this->withBearer((string) $done->json('access_token'))->getJson('/api/v1/me')->assertOk();
        // revokeAll(): refresh tokens die now, and the access token already out is refused
        // at once (#2315).
        $this->withBearer($oldSession['access_token'])->getJson('/api/v1/me')->assertUnauthorized();
        $this->postRefresh($oldSession['refresh_token'])->assertUnauthorized();
        // The replace challenge is single use.
        $this->replaceWithChallenge($challenge, ['code' => $this->code($newSecret)])->assertNotFound();
    }

    public function test_a_sign_out_everywhere_ends_a_password_step_taken_before_it(): void
    {
        $turnedOn = $this->turnOnMfa('bob');
        $challenge = $this->challengeFor('bob');

        app(UserSessionRevoker::class)->revokeAll('bob');

        $late = $this->verifyChallenge($challenge, ['code' => $this->code($turnedOn['secret'])]);
        $this->assertNotSame(200, $late->getStatusCode());
        $this->assertNull($late->json('access_token'));
        $this->assertSame(0, DB::connection('wgw')->table('api_refresh_tokens')->where('username', 'bob')->where('revoked', 0)->count());

        $this->nextStep();
        $done = $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($turnedOn['secret'])])->assertOk();
        $this->withBearer((string) $done->json('access_token'))->getJson('/api/v1/me')->assertOk();
    }

    public function test_abandoned_replacement_leaves_recovery_code_spent(): void
    {
        $turnedOn = $this->turnOnMfa('bob');
        $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => $turnedOn['recovery_codes'][0]])
            ->assertJsonPath('status', 'mfa_replace_required');

        // The user walks away. The old authenticator is still the live one …
        $this->verifyChallenge($this->challengeFor('bob'), ['code' => $this->code($turnedOn['secret'])])->assertOk();
        // … and the recovery code stays spent.
        $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => $turnedOn['recovery_codes'][0]])->assertStatus(401);
        $this->assertSame(9, MfaRecoveryCode::query()->where('username', 'bob')->whereNull('used_at')->count());
    }

    public function test_recovery_codes_are_stored_as_hashes_only(): void
    {
        $codes = $this->turnOnMfa('bob')['recovery_codes'];

        $stored = MfaRecoveryCode::query()->where('username', 'bob')->pluck('code_hash')->all();
        $expected = array_map(static fn (string $c): string => hash('sha256', str_replace('-', '', $c)), $codes);
        sort($stored);
        sort($expected);
        $this->assertSame($expected, $stored);
        $this->assertCount(10, array_unique($codes));
    }

    public function test_an_unreadable_secret_fails_closed(): void
    {
        $this->turnOnMfa('bob');
        DB::connection('wgw')->table('user_mfa')->where('username', 'bob')->update(['totp_secret' => 'not-encrypted']);
        $challenge = $this->challengeFor('bob');

        $this->verifyChallenge($challenge, ['code' => '123456'])
            ->assertStatus(503)
            ->assertJsonPath('code', 'mfa_unavailable');
    }

    public function test_an_unreadable_replacement_secret_fails_closed(): void
    {
        $turnedOn = $this->turnOnMfa('bob');
        $replace = $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => $turnedOn['recovery_codes'][0]]);
        DB::connection('wgw')->table('auth_challenges')->where('kind', 'replace')->update(['pending_secret' => 'not-encrypted']);

        $this->replaceWithChallenge((string) $replace->json('challenge'), ['code' => $this->code((string) $replace->json('secret'))])
            ->assertStatus(503)
            ->assertJsonPath('code', 'mfa_unavailable');
        $this->assertNotNull(UserMfa::query()->where('username', 'bob')->value('enabled_at'));
    }

    // ---- assistant (OAuth) sign-in ----------------------------------------

    public function test_oauth_session_needs_the_code_before_it_signs_in(): void
    {
        $this->enableMcp();
        $secret = $this->turnOnMfa('bob')['secret'];

        $first = $this->postJson('/oauth/session', ['username' => 'bob', 'password' => 'secret', 'intent' => $this->intent()])
            ->assertOk();
        $first->assertJsonPath('status', 'mfa_required')->assertJsonPath('client', 'oauth');
        $this->assertGuest('web');

        $this->postJson('/oauth/session', ['challenge' => $first->json('challenge'), 'code' => $this->wrongCode($secret), 'intent' => $this->intent()])
            ->assertStatus(401)->assertJsonPath('code', 'mfa_code_invalid');
        $this->assertGuest('web');

        $this->postJson('/oauth/session', ['challenge' => $first->json('challenge'), 'code' => $this->code($secret), 'intent' => $this->intent()])
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('status', 'ok')
            ->assertJsonStructure(['redirect']);
        $this->assertAuthenticated('web');
    }

    public function test_oauth_session_form_post_with_two_factor_does_not_sign_in(): void
    {
        $this->enableMcp();
        $this->turnOnMfa('bob');

        $this->post('/oauth/session', ['username' => 'bob', 'password' => 'secret', 'intent' => $this->intent()])
            ->assertRedirect();
        $this->assertGuest('web');
        $this->post('/oauth/session', ['challenge' => str_repeat('a', 64), 'code' => '123456', 'intent' => $this->intent()])->assertStatus(400);
    }

    public function test_oauth_session_recovery_code_then_replacement(): void
    {
        $this->enableMcp();
        $turnedOn = $this->turnOnMfa('bob');
        $challenge = $this->postJson('/oauth/session', ['username' => 'bob', 'password' => 'secret', 'intent' => $this->intent()])
            ->json('challenge');

        $replace = $this->postJson('/oauth/session', ['challenge' => $challenge, 'recovery_code' => $turnedOn['recovery_codes'][0], 'intent' => $this->intent()])
            ->assertOk()
            ->assertJsonPath('status', 'mfa_replace_required')
            ->assertJsonPath('client', 'oauth');
        $this->assertGuest('web');

        $done = $this->postJson('/oauth/session', ['challenge' => $replace->json('challenge'), 'code' => $this->code((string) $replace->json('secret')), 'intent' => $this->intent()])
            ->assertOk()
            ->assertJsonPath('status', 'ok');
        $this->assertCount(10, (array) $done->json('recovery_codes'));
        $this->assertAuthenticated('web');
    }

    // ---- Every password caller refuses the password alone -----------------

    public function test_dav_and_meet_refuse_the_account_password_with_two_factor_on(): void
    {
        $this->turnOnMfa('bob');
        $plain = app(AppPasswordService::class)->create('bob', 'Phone')['password'];
        User::query()->where('username', 'bob')->update(['dav_password_used_at' => null]);

        $this->dav('bob', 'secret')->assertStatus(401);
        $this->assertNull($this->meet('bob', 'secret'));
        $this->assertNull(User::query()->where('username', 'bob')->value('dav_password_used_at'));

        // App passwords keep working; another user's account password too.
        $this->dav('bob', $plain)->assertStatus(207);
        $this->assertSame('bob', $this->meet('bob', $plain));
        $this->dav('carol', 'secret')->assertStatus(207);
    }

    public function test_an_old_client_with_the_account_password_does_not_lock_out_new_app_passwords(): void
    {
        $this->turnOnMfa('bob');
        // The old phone keeps syncing with the account password after two-factor is on.
        for ($attempt = 0; $attempt < LoginRateLimiter::PROTOCOL_USER_IP_LIMIT + 5; $attempt++) {
            $status = $this->dav('bob', 'secret')->status();
            $this->assertContains($status, [401, 429]);
        }
        $this->dav('bob', 'secret')->assertStatus(429);

        // The new app password, made on the same machine, works at once.
        $plain = app(AppPasswordService::class)->create('bob', 'Mac calendar')['password'];
        $this->dav('bob', $plain)->assertStatus(207);
        $this->assertSame('bob', $this->meet('bob', $plain));
    }

    public function test_dav_account_password_warmed_memory_refused_right_after_two_factor_on(): void
    {
        $this->rememberIn(Cache::store('array'));
        $this->dav('bob', 'secret')->assertStatus(207);
        $this->assertSame(['array'], $this->rememberedIn);

        $this->turnOnMfa('bob');

        $this->dav('bob', 'secret')->assertStatus(401);
        $this->assertNull($this->meet('bob', 'secret'));
    }

    public function test_password_only_is_refused_on_each_of_the_four_callers(): void
    {
        $this->enableMcp();
        $this->turnOnMfa('bob');

        // auth/token: a challenge, no token.
        $this->signInWithPassword('bob')->assertOk()->assertJsonMissingPath('access_token');
        // oauth/session: a challenge, no web session.
        $this->postJson('/oauth/session', ['username' => 'bob', 'password' => 'secret', 'intent' => $this->intent()])
            ->assertOk()->assertJsonMissingPath('redirect');
        $this->assertGuest('web');
        // DAV and Meet Basic: refused.
        $this->dav('bob', 'secret')->assertStatus(401);
        $this->assertNull($this->meet('bob', 'secret'));
    }

    // ---- Helpers -----------------------------------------------------------

    private function wrongCode(string $secret): string
    {
        $valid = [$this->code($secret, -1), $this->code($secret), $this->code($secret, 1)];
        for ($n = 0; ; $n++) {
            $candidate = str_pad((string) $n, 6, '0', STR_PAD_LEFT);
            if (! in_array($candidate, $valid, true)) {
                return $candidate;
            }
        }
    }

    private function intent(): string
    {
        return app(ConsentIntent::class)->issue('_login', 'session');
    }

    private function rememberIn(?Repository $store): void
    {
        $this->app->instance(VerifiedPasswordMemory::class, new class($store) extends VerifiedPasswordMemory
        {
            public function __construct(private readonly ?Repository $memory) {}

            public function store(): ?Repository
            {
                return $this->memory;
            }
        });
    }
}
