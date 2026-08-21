<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\ApiPasswordResetToken;
use App\Models\ApiRefreshToken;
use App\Models\Principal;
use App\Models\User;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Support\WgwDatabaseTestCase;

final class PasswordRecoveryTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        Mail::fake();
    }

    public function test_unknown_identifier_returns_generic_ok_without_token(): void
    {
        $this->enableMailDelivery();

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'nobody'])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->assertSame(0, $this->tokenCount());
    }

    public function test_user_without_email_returns_generic_ok_without_token(): void
    {
        $this->enableMailDelivery();
        $this->seedWgwUser('bob', email: 'bob@example.test');
        Principal::query()->where('uri', 'principals/bob')->update(['email' => null]);

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'bob'])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->assertSame(0, $this->tokenCount());
    }

    public function test_cannot_submit_returns_generic_ok_without_token(): void
    {
        $this->seedWgwUser('alice', email: 'alice@example.test');

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'alice'])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->assertSame(0, $this->tokenCount());
    }

    public function test_username_match_stores_hashed_token(): void
    {
        $this->enableMailDelivery();
        $this->seedWgwUser('alice', email: 'alice@example.test');

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'Alice'])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->assertSame(1, $this->tokenCountFor('alice'));
        $row = ApiPasswordResetToken::query()->where('username', 'alice')->first();
        $this->assertNotNull($row);
        $this->assertSame(64, strlen((string) $row->token_hash));
        $this->assertGreaterThan(time() + 3500, (int) $row->expires_at);
    }

    public function test_email_match_is_case_insensitive(): void
    {
        $this->enableMailDelivery();
        $this->seedWgwUser('carol', email: 'carol@example.test');

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'Carol@Example.TEST'])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->assertSame(1, $this->tokenCountFor('carol'));
    }

    public function test_new_request_replaces_previous_token(): void
    {
        $this->enableMailDelivery();
        $this->seedWgwUser('alice', email: 'alice@example.test');

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'alice'])->assertOk();
        $firstHash = $this->latestTokenHash();
        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'alice'])->assertOk();

        $this->assertSame(1, $this->tokenCountFor('alice'));
        $this->assertNotSame($firstHash, $this->latestTokenHash());
    }

    public function test_consume_updates_password_revokes_refresh_tokens_and_cannot_reuse(): void
    {
        $this->seedWgwUser('alice', email: 'alice@example.test', password: 'oldpassword');
        $this->issueRefreshToken('alice');
        $token = $this->storeResetToken('alice');

        $this->postJson('/api/v1/auth/password-resets/'.$token, ['password' => 'newpassword12'])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->assertSame(0, $this->tokenCount());
        $this->assertTrue(password_verify('newpassword12', (string) User::query()->where('username', 'alice')->value('digest')));
        $this->assertSame(0, ApiRefreshToken::query()->where('username', 'alice')->where('revoked', 0)->count());

        $this->postJson('/api/v1/auth/password-resets/'.$token, ['password' => 'anotherpass1'])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_expired_token_returns_400(): void
    {
        $this->seedWgwUser('alice', email: 'alice@example.test');
        $token = $this->storeResetToken('alice', time() - 10);

        $this->postJson('/api/v1/auth/password-resets/'.$token, ['password' => 'newpassword12'])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
        $this->assertTrue(password_verify('secret', (string) User::query()->where('username', 'alice')->value('digest')));
    }

    public function test_short_password_returns_400(): void
    {
        $this->seedWgwUser('alice', email: 'alice@example.test');
        $token = $this->storeResetToken('alice');

        $this->postJson('/api/v1/auth/password-resets/'.$token, ['password' => 'short'])
            ->assertStatus(400)
            ->assertJsonPath('error', 'The password field must be at least 10 characters.');
    }

    public function test_invalid_recipient_is_treated_as_no_send_generic_ok(): void
    {
        $this->enableMailDelivery();
        $this->seedWgwUser('alice', email: 'alice@example.test');
        Principal::query()->where('uri', 'principals/alice')->update(['email' => 'not-an-email']);

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'alice'])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->assertSame(0, $this->tokenCount());
    }

    public function test_request_is_rate_limited(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);
        $this->enableMailDelivery();

        for ($i = 0; $i < 8; $i++) {
            $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'alice'])->assertOk();
        }

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'alice'])
            ->assertStatus(429)
            ->assertJsonPath('code', 'throttled');

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
    }

    public function test_capabilities_exposes_password_recovery_from_can_submit(): void
    {
        $this->assertFalse($this->getJson('/api/v1/capabilities')->json('auth.passwordRecovery'));

        $this->enableMailDelivery();
        $this->assertTrue($this->getJson('/api/v1/capabilities')->json('auth.passwordRecovery'));
    }

    public function test_send_failure_still_returns_generic_ok(): void
    {
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_SMTP,
            SettingKeys::MAIL_DELIVERY_SMTP_HOST => 'smtp.example.test',
            SettingKeys::MAIL_DELIVERY_SMTP_PORT => 587,
            SettingKeys::MAIL_DELIVERY_SMTP_SECURITY => 'starttls',
        ]);
        $this->seedWgwUser('alice', email: 'alice@example.test');

        $this->postJson('/api/v1/auth/password-resets', ['identifier' => 'alice'])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->assertSame(0, $this->tokenCount());
    }

    private function enableMailDelivery(): void
    {
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'ops@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);
    }

    private function storeResetToken(string $username, ?int $expiresAt = null): string
    {
        $token = bin2hex(random_bytes(32));
        ApiPasswordResetToken::query()->create([
            'token_hash' => hash('sha256', $token),
            'username' => $username,
            'expires_at' => $expiresAt ?? time() + 3600,
        ]);

        return $token;
    }

    private function tokenCount(): int
    {
        return (int) DB::connection('wgw')->table('api_password_reset_tokens')->count();
    }

    private function tokenCountFor(string $username): int
    {
        return (int) DB::connection('wgw')->table('api_password_reset_tokens')
            ->where('username', $username)
            ->count();
    }

    private function latestTokenHash(): string
    {
        return (string) DB::connection('wgw')->table('api_password_reset_tokens')->value('token_hash');
    }

    private function issueRefreshToken(string $username): void
    {
        ApiRefreshToken::query()->create([
            'token_hash' => hash('sha256', 'refresh-alice'),
            'username' => $username,
            'role' => 'user',
            'expires_at' => time() + 3600,
            'revoked' => 0,
            'created_at' => time(),
        ]);
    }
}
