<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\Conversion\IanaVTimeZoneFactory;
use PHPUnit\Framework\TestCase;

final class IanaVTimeZoneFactoryTest extends TestCase
{
    /** #1435: a generated VTIMEZONE covers far more than the two years icalcreator defaults to. */
    public function test_generated_time_zone_covers_twenty_years_ahead(): void
    {
        $definition = IanaVTimeZoneFactory::icsDefinition('Europe/Amsterdam');
        $this->assertIsString($definition);

        $this->assertSame(1, preg_match('/TZUNTIL:(\d{4})/', $definition, $match));
        $this->assertGreaterThanOrEqual((int) date('Y') + 20, (int) $match[1]);
        $this->assertStringContainsString('RDATE:'.((int) date('Y') + 15), $definition);
    }
}
