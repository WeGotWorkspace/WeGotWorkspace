<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\CspNonce;
use PHPUnit\Framework\TestCase;

final class CspNonceTest extends TestCase
{
    public function test_value_is_stable_per_instance_and_unique_across_instances(): void
    {
        $a = new CspNonce;
        $this->assertFalse($a->issued());
        $this->assertSame($a->value(), $a->value());
        $this->assertTrue($a->issued());
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9+\/]{22}==$/', $a->value());
        $this->assertNotSame($a->value(), (new CspNonce)->value());
    }
}
