<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\Auth\AuthTokenService;
use Tests\Support\TwoFactorTestHelpers;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #2315 for the two-factor callers of UserSessionRevoker::revokeAll(): turning
 * two-factor on, replacing the authenticator and an admin reset refuse access
 * tokens issued before them at once. Turning it off revokes no session.
 */
final class AccessTokenEpochTwoFactorTest extends WgwDatabaseTestCase
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

    public function test_turning_two_factor_on_refuses_older_access_tokens(): void
    {
        $old = $this->accessTokenFor('bob');
        $before = $this->epochOf('bob');

        $this->turnOnMfa('bob');

        $this->assertSame($before + 1, $this->epochOf('bob'));
        $this->assertRefused($old);
        $this->assertAccepted($this->accessTokenFor('bob'));
    }

    public function test_replacing_the_authenticator_refuses_older_access_tokens(): void
    {
        $turnedOn = $this->turnOnMfa('bob');
        $old = $this->accessTokenFor('bob');
        $before = $this->epochOf('bob');

        $replace = $this->verifyChallenge($this->challengeFor('bob'), ['recovery_code' => $turnedOn['recovery_codes'][0]])
            ->assertJsonPath('status', 'mfa_replace_required');
        $done = $this->replaceWithChallenge(
            (string) $replace->json('challenge'),
            ['code' => $this->code((string) $replace->json('secret'))],
        )->assertOk();

        $this->assertSame($before + 1, $this->epochOf('bob'));
        $this->assertRefused($old);
        $this->assertAccepted((string) $done->json('access_token'));
    }

    public function test_an_admin_reset_refuses_older_access_tokens(): void
    {
        $this->turnOnMfa('bob');
        $old = $this->accessTokenFor('bob');
        $before = $this->epochOf('bob');

        $this->withBearer($this->accessTokenFor('alice'))
            ->postJson('/api/v1/admin/users/bob/mfa-resets')->assertOk();

        $this->assertSame($before + 1, $this->epochOf('bob'));
        $this->assertRefused($old);
        $signedIn = $this->signInWithPassword('bob')->assertOk()->assertJsonPath('status', 'ok');
        $this->assertAccepted((string) $signedIn->json('access_token'));
    }

    public function test_turning_two_factor_off_leaves_access_tokens_accepted(): void
    {
        $turnedOn = $this->turnOnMfa('bob');
        $settings = $this->accessTokenFor('bob');
        $otherDevice = $this->accessTokenFor('bob');
        $before = $this->epochOf('bob');

        $this->nextStep();
        $this->withBearer($settings)
            ->deleteJson('/api/v1/settings/totp', ['code' => $this->code($turnedOn['secret'])])
            ->assertOk();

        $this->assertSame($before, $this->epochOf('bob'));
        $this->assertAccepted($settings);
        $this->assertAccepted($otherDevice);
    }

    private function accessTokenFor(string $username): string
    {
        return app(AuthTokenService::class)->issueForUsername($username)['access_token'];
    }

    private function epochOf(string $username): int
    {
        return (int) User::query()->where('username', $username)->value('access_token_epoch');
    }

    private function assertRefused(string $token): void
    {
        $this->withBearer($token)->getJson('/api/v1/me')->assertUnauthorized();
    }

    private function assertAccepted(string $token): void
    {
        $this->withBearer($token)->getJson('/api/v1/me')->assertOk();
    }
}
