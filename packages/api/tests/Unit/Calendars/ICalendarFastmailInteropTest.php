<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Text::JSCalendar iCalendar golden fixtures — WGW-owned key-field goldens.
 *
 * @see packages/api/tests/fixtures/README.md
 */
final class ICalendarFastmailInteropTest extends TestCase
{
    private ICalendarJmapEventConverter $converter;

    private string $fixturesDir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new ICalendarJmapEventConverter;
        $this->fixturesDir = dirname(__DIR__, 2).'/fixtures/Calendars/Fastmail';
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function fastmailFixtureProvider(): array
    {
        $dir = dirname(__DIR__, 2).'/fixtures/Calendars/Fastmail';
        $fixtures = [];
        foreach (glob($dir.'/*.ics') ?: [] as $path) {
            $name = basename($path, '.ics');
            $fixtures[$name] = [$name];
        }

        return $fixtures;
    }

    #[DataProvider('fastmailFixtureProvider')]
    public function test_fastmail_ics_matches_wgw_key_field_golden(string $fixture): void
    {
        $ics = (string) file_get_contents("{$this->fixturesDir}/{$fixture}.ics");
        $expected = json_decode((string) file_get_contents("{$this->fixturesDir}/{$fixture}.json"), true);
        $event = $this->converter->eventFromIcs($ics);

        $this->assertSame('Event', $event['@type'] ?? null);
        foreach ($expected as $key => $value) {
            $actual = match ($key) {
                'participantCount' => count($event['participants'] ?? []),
                'locationCount' => count($event['locations'] ?? []),
                'alertCount' => count($event['alerts'] ?? []),
                'frequency' => $event['recurrenceRules'][0]['frequency'] ?? null,
                'byDay' => $event['recurrenceRules'][0]['byDay'] ?? null,
                default => $event[$key] ?? null,
            };
            $this->assertSame($value, $actual, "Mismatch on {$key} for {$fixture}");
        }
    }

    #[DataProvider('fastmailFixtureProvider')]
    public function test_fastmail_ics_round_trip_is_stable(string $fixture): void
    {
        $ics = (string) file_get_contents("{$this->fixturesDir}/{$fixture}.ics");
        $event = $this->converter->eventFromIcs($ics);

        $roundTripIcs = $this->converter->icsFromEvent(array_merge($event, [
            'calendarIds' => ['default' => true],
        ]));
        $this->assertStringContainsString('BEGIN:VEVENT', $roundTripIcs);

        $once = $this->converter->eventFromIcs($roundTripIcs);
        $twice = $this->converter->eventFromIcs($roundTripIcs);

        $this->assertSame($once, $twice, "ICS round-trip re-parse should be stable for {$fixture}");
    }
}
