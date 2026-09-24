<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\MinishlinkWebPushSender;
use PHPUnit\Framework\TestCase;

final class MinishlinkWebPushSenderTest extends TestCase
{
    public function test_gmp_recommendation_is_ignorable(): void
    {
        $this->assertTrue(MinishlinkWebPushSender::isIgnorableCalculatorWarning(
            'It is highly recommended to install the GMP or BCMath extension to speed up calculations. The fastest available calculator implementation will be automatically selected at runtime.',
        ));
        $this->assertFalse(MinishlinkWebPushSender::isIgnorableCalculatorWarning('VAPID authentication failed'));
    }
}
