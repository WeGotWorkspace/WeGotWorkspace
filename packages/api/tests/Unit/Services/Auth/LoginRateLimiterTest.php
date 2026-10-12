<?php

declare(strict_types=1);

namespace Tests\Unit\Services\Auth;

use App\Services\Auth\LoginRateLimiter;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

final class LoginRateLimiterTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);

        config(['cache.default' => 'array']);
        Cache::flush();
    }

    public function test_blocks_after_user_ip_limit(): void
    {
        $limiter = $this->app->make(LoginRateLimiter::class);

        for ($i = 0; $i < 8; $i++) {
            $this->assertTrue($limiter->allow('alice', '203.0.113.1'), "attempt {$i} should be allowed");
            $limiter->hit('alice', '203.0.113.1');
        }

        $this->assertFalse($limiter->allow('alice', '203.0.113.1'));
    }

    public function test_different_user_on_same_ip_has_separate_user_ip_bucket(): void
    {
        $limiter = $this->app->make(LoginRateLimiter::class);

        for ($i = 0; $i < 8; $i++) {
            $limiter->allow('alice', '203.0.113.1');
            $limiter->hit('alice', '203.0.113.1');
        }
        $this->assertFalse($limiter->allow('alice', '203.0.113.1'));

        $this->assertTrue($limiter->allow('bob', '203.0.113.1'));
    }

    public function test_reset_clears_user_ip_bucket_only(): void
    {
        $limiter = $this->app->make(LoginRateLimiter::class);

        for ($i = 0; $i < 8; $i++) {
            $limiter->allow('alice', '203.0.113.1');
            $limiter->hit('alice', '203.0.113.1');
        }
        $this->assertFalse($limiter->allow('alice', '203.0.113.1'));

        $limiter->reset('alice', '203.0.113.1');

        $this->assertTrue($limiter->allow('alice', '203.0.113.1'));
    }

    public function test_still_limits_when_app_env_is_local(): void
    {
        $this->app['env'] = 'local';

        $limiter = $this->app->make(LoginRateLimiter::class);

        for ($i = 0; $i < 8; $i++) {
            $this->assertTrue($limiter->allow('alice', '203.0.113.1'), "attempt {$i} should be allowed");
            $limiter->hit('alice', '203.0.113.1');
        }

        $this->assertFalse($limiter->allow('alice', '203.0.113.1'));
    }

    public function test_respects_disable_env_flag(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $limiter = $this->app->make(LoginRateLimiter::class);

        for ($i = 0; $i < 20; $i++) {
            $this->assertTrue($limiter->allow('alice', '203.0.113.1'));
            $limiter->hit('alice', '203.0.113.1');
        }
    }

    public function test_allow_does_not_consume_budget_until_a_failure_is_recorded(): void
    {
        $limiter = $this->app->make(LoginRateLimiter::class);

        for ($i = 0; $i < 20; $i++) {
            $this->assertTrue($limiter->allow('alice', '203.0.113.1'));
        }
    }

    public function test_blocks_one_user_across_source_ips(): void
    {
        $limiter = $this->app->make(LoginRateLimiter::class);

        for ($host = 1; $host <= LoginRateLimiter::USER_LIMIT; $host++) {
            $ip = '203.0.113.'.$host;
            $this->assertTrue($limiter->allow('alice', $ip), "attempt {$host} should be allowed");
            $limiter->hit('alice', $ip);
        }

        $this->assertFalse($limiter->allow('alice', '203.0.113.40'));
        $this->assertTrue($limiter->allow('bob', '203.0.113.40'));
    }

    public function test_protocol_user_ip_limit_does_not_lock_web_login(): void
    {
        $limiter = $this->app->make(LoginRateLimiter::class);

        for ($i = 0; $i < LoginRateLimiter::PROTOCOL_USER_IP_LIMIT; $i++) {
            $this->assertTrue($limiter->allowProtocol('alice', '203.0.113.1'));
            $limiter->hitProtocol('alice', '203.0.113.1');
        }

        $this->assertFalse($limiter->allowProtocol('alice', '203.0.113.1'));
        $this->assertTrue($limiter->allow('alice', '203.0.113.1'));
        $this->assertTrue($limiter->allowProtocol('bob', '203.0.113.1'));
    }

    public function test_protocol_failures_share_the_per_user_ceiling(): void
    {
        $limiter = $this->app->make(LoginRateLimiter::class);

        for ($host = 1; $host <= LoginRateLimiter::USER_LIMIT; $host++) {
            $ip = '198.51.100.'.$host;
            $this->assertTrue($limiter->allowProtocol('alice', $ip), "protocol {$host} should be allowed");
            $limiter->hitProtocol('alice', $ip);
        }

        $this->assertFalse($limiter->allow('alice', '198.51.100.40'));
        $this->assertFalse($limiter->allowProtocol('alice', '198.51.100.40'));
        $this->assertTrue($limiter->allow('bob', '198.51.100.40'));
    }
}
