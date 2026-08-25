<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\Conversion\IanaVTimeZoneFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VTimeZone;
use Sabre\VObject\Reader;

final class IanaVTimeZoneFactoryTest extends TestCase
{
    public function test_unknown_tzid_returns_null(): void
    {
        $this->assertNull(IanaVTimeZoneFactory::icsDefinition('Not/A-Real-Zone'));
        $this->assertNull(IanaVTimeZoneFactory::icsDefinition(''));
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function ianaIdProvider(): array
    {
        return [
            'amsterdam' => ['Europe/Amsterdam'],
            'new_york' => ['America/New_York'],
            'tokyo' => ['Asia/Tokyo'],
            'utc' => ['UTC'],
            'etc_utc' => ['Etc/UTC'],
        ];
    }

    #[DataProvider('ianaIdProvider')]
    public function test_known_iana_ids_emit_parseable_vtimezone(string $tzid): void
    {
        $definition = IanaVTimeZoneFactory::icsDefinition($tzid);
        $this->assertIsString($definition);
        $this->assertStringContainsString('BEGIN:VTIMEZONE', $definition);
        $this->assertStringContainsString('TZID:'.$tzid, $definition);
        $this->assertStringContainsString('END:VTIMEZONE', $definition);

        $parsed = Reader::read("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{$definition}\r\nEND:VCALENDAR\r\n");
        $this->assertInstanceOf(VCalendar::class, $parsed);
        $components = $parsed->select('VTIMEZONE');
        $this->assertCount(1, $components);
        $this->assertInstanceOf(VTimeZone::class, $components[0]);
        $this->assertSame($tzid, trim((string) $components[0]->TZID->getValue()));
    }

    public function test_amsterdam_includes_standard_and_daylight_offsets(): void
    {
        $definition = IanaVTimeZoneFactory::icsDefinition('Europe/Amsterdam');
        $this->assertIsString($definition);
        $this->assertStringContainsString('BEGIN:STANDARD', $definition);
        $this->assertStringContainsString('BEGIN:DAYLIGHT', $definition);
        $this->assertStringContainsString('TZOFFSETTO:+0100', $definition);
        $this->assertStringContainsString('TZOFFSETTO:+0200', $definition);
    }

    public function test_tokyo_is_fixed_offset_standard_only(): void
    {
        $definition = IanaVTimeZoneFactory::icsDefinition('Asia/Tokyo');
        $this->assertIsString($definition);
        $this->assertStringContainsString('BEGIN:STANDARD', $definition);
        $this->assertStringContainsString('TZOFFSETTO:+0900', $definition);
        $this->assertStringNotContainsString('BEGIN:DAYLIGHT', $definition);
    }

    public function test_utc_vtimezone_uses_library_tzid_only_form(): void
    {
        $definition = IanaVTimeZoneFactory::icsDefinition('UTC');
        $this->assertIsString($definition);
        $this->assertStringContainsString('TZID:UTC', $definition);
        $this->assertStringNotContainsString('BEGIN:DAYLIGHT', $definition);
    }
}
