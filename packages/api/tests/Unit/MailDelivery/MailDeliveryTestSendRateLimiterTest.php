<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\MailDeliveryTestSendRateLimiter;
use Illuminate\Cache\RateLimiter;
use Tests\TestCase;

/**
 * The limiter is off in tests unless WGW_MAIL_DELIVERY_THROTTLE_TESTS turns it on.
 */
final class MailDeliveryTestSendRateLimiterTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_MAIL_DELIVERY_THROTTLE_TESTS=1');
        putenv('WGW_DISABLE_MAIL_DELIVERY_THROTTLE');
        app(RateLimiter::class)->clear('mail-delivery-test:admin:203.0.113.5');
        app(RateLimiter::class)->clear('mail-delivery-test:admin:198.51.100.7');
        app(RateLimiter::class)->clear('mail-delivery-test:other:203.0.113.5');
        app(RateLimiter::class)->clear('mail-delivery-test:admin:unknown');
    }

    protected function tearDown(): void
    {
        putenv('WGW_MAIL_DELIVERY_THROTTLE_TESTS');
        putenv('WGW_DISABLE_MAIL_DELIVERY_THROTTLE');

        parent::tearDown();
    }

    public function test_allows_five_test_sends_then_blocks(): void
    {
        $limiter = app(MailDeliveryTestSendRateLimiter::class);

        for ($i = 1; $i <= 5; $i++) {
            $this->assertTrue($limiter->allow('admin', '203.0.113.5'), 'send '.$i);
        }

        $this->assertFalse($limiter->allow('admin', '203.0.113.5'));
    }

    public function test_counts_per_user_and_address(): void
    {
        $limiter = app(MailDeliveryTestSendRateLimiter::class);
        for ($i = 1; $i <= 5; $i++) {
            $limiter->allow('admin', '203.0.113.5');
        }

        $this->assertFalse($limiter->allow(' Admin ', '203.0.113.5'));
        $this->assertTrue($limiter->allow('admin', '198.51.100.7'));
        $this->assertTrue($limiter->allow('other', '203.0.113.5'));
    }

    public function test_an_empty_address_shares_one_bucket(): void
    {
        $limiter = app(MailDeliveryTestSendRateLimiter::class);
        for ($i = 1; $i <= 5; $i++) {
            $this->assertTrue($limiter->allow('admin', ''));
        }

        $this->assertFalse($limiter->allow('admin', ''));
    }

    public function test_disable_flag_turns_the_limit_off_in_testing(): void
    {
        putenv('WGW_DISABLE_MAIL_DELIVERY_THROTTLE=true');
        $limiter = app(MailDeliveryTestSendRateLimiter::class);

        for ($i = 1; $i <= 7; $i++) {
            $this->assertTrue($limiter->allow('admin', '203.0.113.5'), 'send '.$i);
        }
    }

    public function test_limit_is_off_in_tests_by_default(): void
    {
        putenv('WGW_MAIL_DELIVERY_THROTTLE_TESTS');
        $limiter = app(MailDeliveryTestSendRateLimiter::class);

        for ($i = 1; $i <= 7; $i++) {
            $this->assertTrue($limiter->allow('admin', '203.0.113.5'), 'send '.$i);
        }
    }

    public function test_disable_flag_is_ignored_in_production(): void
    {
        $this->assertFalse(MailDeliveryTestSendRateLimiter::honorsDisableFlag('production', '1'));
        $this->assertFalse(MailDeliveryTestSendRateLimiter::honorsDisableFlag('production', 'true'));
        $this->assertFalse(MailDeliveryTestSendRateLimiter::honorsDisableFlag('staging', '1'));
    }

    public function test_disable_flag_is_honored_in_local_and_testing(): void
    {
        $this->assertTrue(MailDeliveryTestSendRateLimiter::honorsDisableFlag('local', '1'));
        $this->assertTrue(MailDeliveryTestSendRateLimiter::honorsDisableFlag('testing', 'true'));
        $this->assertFalse(MailDeliveryTestSendRateLimiter::honorsDisableFlag('local', ''));
        $this->assertFalse(MailDeliveryTestSendRateLimiter::honorsDisableFlag('testing', '0'));
    }
}
