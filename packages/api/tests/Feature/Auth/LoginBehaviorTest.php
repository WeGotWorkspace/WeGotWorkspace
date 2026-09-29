<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Services\Auth\LoginRateLimiter;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;

final class LoginBehaviorTest extends WgwDatabaseTestCase
{
    private const string USERNAME = 'alice';

    private const string PASSWORD = 'secret';

    private ?string $previousThrottleEnv = null;

    protected function setUp(): void
    {
        $this->previousThrottleEnv = getenv('WGW_DISABLE_LOGIN_THROTTLE') ?: null;
        $this->enableLoginThrottle();
        parent::setUp();
        $this->enableLoginThrottle();

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->seedWgwUser(self::USERNAME, displayName: 'Alice');
    }

    protected function tearDown(): void
    {
        if ($this->previousThrottleEnv !== null) {
            putenv("WGW_DISABLE_LOGIN_THROTTLE={$this->previousThrottleEnv}");
            $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = $this->previousThrottleEnv;
        } else {
            $this->enableLoginThrottle();
        }
        parent::tearDown();
    }

    public function test_unknown_user_returns_invalid_credentials(): void
    {
        $this->postCredentials('nobody', self::PASSWORD)
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid credentials.',
                'code' => 'unauthorized',
            ]);
    }

    public function test_disabled_user_cannot_log_in(): void
    {
        User::query()->where('username', self::USERNAME)->update(['enabled' => false]);

        $this->postCredentials(self::USERNAME, self::PASSWORD)
            ->assertUnauthorized()
            ->assertJson([
                'error' => 'Invalid credentials.',
                'code' => 'unauthorized',
            ]);
    }

    public function test_login_locks_out_after_repeated_failures(): void
    {
        for ($attempt = 0; $attempt < LoginRateLimiter::USER_IP_LIMIT; $attempt++) {
            $this->postCredentials(self::USERNAME, 'wrong')->assertUnauthorized();
        }

        $this->postCredentials(self::USERNAME, self::PASSWORD)
            ->assertStatus(429)
            ->assertJson([
                'error' => 'Too many login attempts. Please try again later.',
                'code' => 'throttled',
            ]);
    }

    public function test_login_lockout_expires(): void
    {
        for ($attempt = 0; $attempt < LoginRateLimiter::USER_IP_LIMIT; $attempt++) {
            $this->postCredentials(self::USERNAME, 'wrong')->assertUnauthorized();
        }
        $this->postCredentials(self::USERNAME, self::PASSWORD)->assertStatus(429);

        $this->travel(LoginRateLimiter::DECAY_SECONDS + 1)->seconds();

        $this->postCredentials(self::USERNAME, self::PASSWORD)
            ->assertOk()
            ->assertJsonPath('username', self::USERNAME);
    }

    public function test_successful_login_resets_the_user_lockout_counter(): void
    {
        for ($attempt = 0; $attempt < LoginRateLimiter::USER_IP_LIMIT - 1; $attempt++) {
            $this->postCredentials(self::USERNAME, 'wrong')->assertUnauthorized();
        }

        $this->postCredentials(self::USERNAME, self::PASSWORD)->assertOk();

        for ($attempt = 0; $attempt < LoginRateLimiter::USER_IP_LIMIT; $attempt++) {
            $this->postCredentials(self::USERNAME, 'wrong')->assertUnauthorized();
        }

        $this->postCredentials(self::USERNAME, 'wrong')
            ->assertStatus(429)
            ->assertJsonPath('code', 'throttled');
    }

    public function test_ip_level_rate_limit_blocks_credential_stuffing(): void
    {
        // Attempt IP_LIMIT failed logins, each with a unique username
        for ($i = 0; $i < LoginRateLimiter::IP_LIMIT; $i++) {
            $username = "stuffing-user-{$i}";
            $this->seedWgwUser($username, displayName: "Stuffing User {$i}");
            $this->postCredentials($username, 'wrong')->assertUnauthorized();
        }

        // Next attempt from same IP should be throttled by IP limit
        $this->seedWgwUser('fresh-user', displayName: 'Fresh User');
        $this->postCredentials('fresh-user', self::PASSWORD)
            ->assertStatus(429)
            ->assertJson([
                'error' => 'Too many login attempts. Please try again later.',
                'code' => 'throttled',
            ]);
    }

    private function postCredentials(string $username, string $password): TestResponse
    {
        return $this->postJson('/api/v1/auth/token', [
            'username' => $username,
            'password' => $password,
        ]);
    }

    private function enableLoginThrottle(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);
    }
}
