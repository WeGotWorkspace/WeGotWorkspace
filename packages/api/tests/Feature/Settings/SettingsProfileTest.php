<?php

declare(strict_types=1);

namespace Tests\Feature\Settings;

use App\Models\Principal;
use App\Services\Auth\LoginRateLimiter;
use Tests\Support\SettingsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class SettingsProfileTest extends WgwDatabaseTestCase
{
    use SettingsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSettingsFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownSettingsFixtures();
        parent::tearDown();
    }

    public function test_settings_state_returns_profile_fields_for_authenticated_user(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.username', 'bob')
            ->assertJsonPath('user.displayName', 'Bob')
            ->assertJsonPath('user.email', 'bob@example.test');
    }

    public function test_each_user_sees_own_profile_fields_only(): void
    {
        $bobState = $this->withBearer($this->userBearerToken())->getJson('/api/v1/settings/state');
        $bobState->assertOk()->assertJsonPath('user.username', 'bob');

        $aliceState = $this->withBearer($this->adminBearerToken())->getJson('/api/v1/settings/state');
        $aliceState->assertOk()
            ->assertJsonPath('user.username', 'alice')
            ->assertJsonPath('user.displayName', 'Alice')
            ->assertJsonPath('user.email', 'alice@example.test');
    }

    public function test_save_display_name_and_email_persists(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'displayName' => 'Robert',
            'email' => 'robert@example.test',
        ])
            ->assertOk()
            ->assertJsonPath('user.displayName', 'Robert')
            ->assertJsonPath('user.email', 'robert@example.test');

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.displayName', 'Robert')
            ->assertJsonPath('user.email', 'robert@example.test');
    }

    public function test_username_cannot_be_changed_via_profile_update(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'displayName' => 'Robert',
            'email' => 'robert@example.test',
            'username' => 'hacker',
        ])
            ->assertOk()
            ->assertJsonPath('user.username', 'bob');

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.username', 'bob');
    }

    public function test_cleared_display_name_falls_back_to_username_in_state(): void
    {
        $principal = Principal::forUsername('bob');
        $this->assertNotNull($principal);
        $principal->displayname = null;
        $principal->save();

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.displayName', 'bob');
    }

    public function test_password_change_allows_login_with_new_password(): void
    {
        $token = $this->userBearerToken();
        $newPassword = 'newpassword12';

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'password' => $newPassword,
        ])->assertOk();

        $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => $newPassword,
        ])->assertOk();

        $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertUnauthorized();
    }

    public function test_short_password_returns_bad_request(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'password' => 'short',
        ])->assertStatus(400)
            ->assertJsonPath('error', 'The password field must be at least 10 characters.');
    }

    public function test_profile_update_without_password_leaves_existing_password_unchanged(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'displayName' => 'Bob Updated',
        ])->assertOk();

        $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertOk();
    }

    public function test_oversized_display_name_returns_unprocessable(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'displayName' => str_repeat('a', 256),
        ])->assertStatus(400);
    }

    public function test_password_change_without_current_password_is_rejected(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'password' => 'newpassword12',
        ])->assertStatus(400);

        $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertOk();
    }

    public function test_password_change_with_wrong_current_password_is_rejected(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'password' => 'newpassword12',
            'currentPassword' => 'not-the-password',
        ])->assertStatus(403)
            ->assertJsonPath('code', 'current_password_invalid');

        $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertOk();
    }

    public function test_password_change_with_right_current_password_succeeds(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'password' => 'newpassword12',
            'currentPassword' => 'secret',
        ])->assertOk();

        $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'newpassword12',
        ])->assertOk();
    }

    public function test_email_change_without_current_password_is_rejected(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'email' => 'stolen@example.test',
        ])->assertStatus(400);

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.email', 'bob@example.test');
    }

    public function test_email_change_with_wrong_current_password_is_rejected(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'email' => 'stolen@example.test',
            'currentPassword' => 'not-the-password',
        ])->assertStatus(403)
            ->assertJsonPath('code', 'current_password_invalid');

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.email', 'bob@example.test');
    }

    public function test_email_change_with_right_current_password_succeeds(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'email' => 'robert@example.test',
            'currentPassword' => 'secret',
        ])->assertOk()
            ->assertJsonPath('user.email', 'robert@example.test');
    }

    public function test_clearing_email_without_current_password_is_rejected(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'email' => '',
        ])->assertStatus(403)
            ->assertJsonPath('code', 'current_password_invalid');

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.email', 'bob@example.test');
    }

    public function test_mail_settings_do_not_change_the_profile_email(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->putJson('/api/v1/settings/mail', [
            'imapUsername' => 'bob.sync@example.test',
            'imapPassword' => 'mail-secret',
        ])->assertOk()
            ->assertJsonPath('user.email', 'bob@example.test');

        $this->withBearer($token)->getJson('/api/v1/settings/state')
            ->assertOk()
            ->assertJsonPath('user.email', 'bob@example.test');
    }

    public function test_password_change_revokes_other_refresh_tokens_and_keeps_the_callers(): void
    {
        $caller = $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertOk();
        $access = (string) $caller->json('access_token');
        $refresh = (string) $caller->json('refresh_token');

        $other = $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertOk();
        $otherRefresh = (string) $other->json('refresh_token');

        $this->withBearer($access)->putJson('/api/v1/settings/profile', [
            'password' => 'newpassword12',
            'currentPassword' => 'secret',
            'refreshToken' => $refresh,
        ])->assertOk();

        $this->postJson('/api/v1/auth/refresh', [
            'refresh_token' => $refresh,
        ])->assertOk();

        $this->postJson('/api/v1/auth/refresh', [
            'refresh_token' => $otherRefresh,
        ])->assertUnauthorized();
    }

    public function test_wrong_current_password_shares_the_login_rate_limit(): void
    {
        $token = $this->userBearerToken();
        $this->enableLoginThrottle();

        for ($attempt = 0; $attempt < LoginRateLimiter::USER_IP_LIMIT; $attempt++) {
            $this->withBearer($token)->putJson('/api/v1/settings/profile', [
                'password' => 'newpassword12',
                'currentPassword' => 'not-the-password',
            ])->assertStatus(403)
                ->assertJsonPath('code', 'current_password_invalid');
        }

        $this->withBearer($token)->putJson('/api/v1/settings/profile', [
            'password' => 'newpassword12',
            'currentPassword' => 'secret',
        ])->assertStatus(429)
            ->assertJsonPath('code', 'throttled');

        $this->postJson('/api/v1/auth/token', [
            'username' => 'bob',
            'password' => 'secret',
        ])->assertStatus(429)
            ->assertJsonPath('code', 'throttled');
    }

    private function enableLoginThrottle(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);
    }
}
