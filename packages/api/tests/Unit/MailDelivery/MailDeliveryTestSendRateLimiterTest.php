<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\MailDeliveryTestSendRateLimiter;
use PHPUnit\Framework\TestCase;

final class MailDeliveryTestSendRateLimiterTest extends TestCase
{
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
