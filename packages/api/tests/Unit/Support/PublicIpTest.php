<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\Net\PublicIp;
use PHPUnit\Framework\TestCase;

final class PublicIpTest extends TestCase
{
    public function test_mapped_private_and_loopback_addresses_are_not_public(): void
    {
        foreach ([
            '::ffff:127.0.0.1',
            '::ffff:a9fe:a9fe',
            '::127.0.0.1',
            '10.0.0.1',
            '169.254.169.254',
            '::1',
        ] as $ip) {
            $this->assertFalse(PublicIp::isPublic($ip), $ip);
        }
    }

    public function test_global_unicast_addresses_are_public(): void
    {
        $this->assertTrue(PublicIp::isPublic('8.8.8.8'));
        $this->assertTrue(PublicIp::isPublic('2001:4860:4860::8888'));
    }
}
