<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use App\Services\Calendars\Conversion\TimeZoneSupport;
use PHPUnit\Framework\TestCase;
use Sabre\VObject\Component\VCalendar;
use Tests\Support\AssertsIcsTimeZones;

/**
 * #608: outbound ICS must emit VTIMEZONE for every TZID, including events
 * created with a bare IANA `timeZone` and no `timeZones[].icsDefinition`.
 */
final class ICalendarTimezoneWriteTest extends TestCase
{
    use AssertsIcsTimeZones;

    private ICalendarJmapEventConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new ICalendarJmapEventConverter;
    }

    public function test_bare_iana_timezone_writes_vtimezone_and_keeps_wall_clock(): void
    {
        $ics = $this->converter->icsFromEvent($this->amsterdamEvent());

        $this->assertStringContainsString('DTSTART;TZID=Europe/Amsterdam:20260615T100000', $ics);
        $this->assertStringContainsString('DTEND;TZID=Europe/Amsterdam:20260615T110000', $ics);
        $this->assertEveryTzidHasVTimeZone($ics);
        $this->assertStringContainsString('TZOFFSETTO:+0200', $ics);
    }

    public function test_bare_iana_timezone_round_trips_through_jmap(): void
    {
        $ics = $this->converter->icsFromEvent($this->amsterdamEvent());
        $event = $this->converter->eventFromIcs($ics);

        $this->assertSame('Europe/Amsterdam', $event['timeZone']);
        $this->assertSame('2026-06-15T10:00:00', $event['start']);
        $this->assertArrayHasKey('Europe/Amsterdam', $event['timeZones'] ?? []);
        $this->assertArrayHasKey('icsDefinition', $event['timeZones']['Europe/Amsterdam']);
        $this->assertStringContainsString('BEGIN:VTIMEZONE', $event['timeZones']['Europe/Amsterdam']['icsDefinition']);
    }

    public function test_timezones_map_without_ics_definition_still_emits_vtimezone(): void
    {
        $event = $this->amsterdamEvent();
        $event['timeZones'] = [
            'Europe/Amsterdam' => [
                '@type' => 'TimeZone',
                'tzid' => 'Europe/Amsterdam',
            ],
        ];

        $ics = $this->converter->icsFromEvent($event);
        $this->assertEveryTzidHasVTimeZone($ics);
    }

    public function test_write_time_zones_to_calendar_synthesizes_from_event_timezone(): void
    {
        $calendar = new VCalendar([], false);
        $calendar->add('VERSION', '2.0');
        $vevent = $calendar->add('VEVENT', []);
        $vevent->add('DTSTART', '20260615T100000', ['TZID' => 'Europe/Amsterdam']);
        TimeZoneSupport::writeTimeZonesToCalendar($calendar, [
            'timeZone' => 'Europe/Amsterdam',
        ]);

        $this->assertNotSame([], $calendar->select('VTIMEZONE'));
        $serialized = $calendar->serialize();
        $this->assertStringContainsString('BEGIN:VTIMEZONE', $serialized);
        $this->assertStringContainsString('TZID:Europe/Amsterdam', $serialized);
    }

    public function test_utc_z_timestamps_do_not_emit_tzid_or_vtimezone(): void
    {
        $ics = $this->converter->icsFromEvent([
            '@type' => 'Event',
            'uid' => 'utc-z-1',
            'title' => 'UTC meeting',
            'start' => '2026-06-15T10:00:00Z',
            'end' => '2026-06-15T11:00:00Z',
        ]);

        $this->assertStringContainsString('DTSTART:20260615T100000Z', $ics);
        $this->assertStringNotContainsString('TZID=', $ics);
        $this->assertEveryTzidHasVTimeZone($ics);
    }

    public function test_floating_local_times_do_not_emit_tzid_or_vtimezone(): void
    {
        $ics = $this->converter->icsFromEvent([
            '@type' => 'Event',
            'uid' => 'float-1',
            'title' => 'Floating',
            'start' => '2026-06-15T10:00:00',
            'end' => '2026-06-15T11:00:00',
        ]);

        $this->assertStringContainsString('DTSTART:20260615T100000', $ics);
        $this->assertStringNotContainsString('TZID=', $ics);
        $this->assertEveryTzidHasVTimeZone($ics);
    }

    public function test_all_day_events_do_not_emit_tzid_or_vtimezone(): void
    {
        $ics = $this->converter->icsFromEvent([
            '@type' => 'Event',
            'uid' => 'allday-tz-1',
            'title' => 'Holiday',
            'start' => '2026-07-04',
            'end' => '2026-07-05',
            'showWithoutTime' => true,
            'timeZone' => 'Europe/Amsterdam',
        ]);

        $this->assertStringContainsString('DTSTART;VALUE=DATE:20260704', $ics);
        $this->assertStringNotContainsString('TZID=', $ics);
        $this->assertEveryTzidHasVTimeZone($ics);
    }

    public function test_recurring_iana_event_emits_one_vtimezone(): void
    {
        $ics = $this->converter->icsFromEvent([
            ...$this->amsterdamEvent(),
            'uid' => 'recur-ams-1',
            'recurrenceRules' => [[
                '@type' => 'RecurrenceRule',
                'frequency' => 'weekly',
                'count' => 4,
            ]],
        ]);

        $this->assertStringContainsString('RRULE:FREQ=WEEKLY;COUNT=4', $ics);
        $this->assertSame(1, substr_count($ics, 'BEGIN:VTIMEZONE'));
        $this->assertEveryTzidHasVTimeZone($ics);
    }

    public function test_override_with_different_timezone_emits_both_vtimezones(): void
    {
        $ics = $this->converter->icsFromEvent([
            ...$this->amsterdamEvent(),
            'uid' => 'override-tz-1',
            'recurrenceRules' => [[
                '@type' => 'RecurrenceRule',
                'frequency' => 'weekly',
                'count' => 4,
            ]],
            'recurrenceOverrides' => [
                '2026-06-22T10:00:00' => [
                    'start' => '2026-06-22T10:00:00',
                    'end' => '2026-06-22T11:00:00',
                    'timeZone' => 'America/New_York',
                ],
            ],
        ]);

        $this->assertEveryTzidHasVTimeZone($ics);
        $this->assertContains('Europe/Amsterdam', $this->tzidsDefinedInIcs($ics));
        $this->assertContains('America/New_York', $this->tzidsDefinedInIcs($ics));
    }

    public function test_existing_ics_definition_is_preferred_over_generated(): void
    {
        $ics = $this->converter->icsFromEvent([
            ...$this->amsterdamEvent(),
            'timeZones' => [
                'Europe/Amsterdam' => [
                    '@type' => 'TimeZone',
                    'tzid' => 'Europe/Amsterdam',
                    'icsDefinition' => "BEGIN:VTIMEZONE\r\nTZID:Europe/Amsterdam\r\nX-LIC-LOCATION:Europe/Amsterdam\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nTZNAME:CUSTOM-CET\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nTZNAME:CUSTOM-CEST\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\n",
                ],
            ],
        ]);

        $this->assertEveryTzidHasVTimeZone($ics);
        $this->assertStringContainsString('TZNAME:CUSTOM-CET', $ics);
        $this->assertStringContainsString('TZNAME:CUSTOM-CEST', $ics);
    }

    public function test_unknown_tzid_does_not_throw_or_emit_broken_vtimezone(): void
    {
        $ics = $this->converter->icsFromEvent([
            '@type' => 'Event',
            'uid' => 'unknown-tz-1',
            'title' => 'Mystery zone',
            'start' => '2026-06-15T10:00:00',
            'end' => '2026-06-15T11:00:00',
            'timeZone' => 'Not/A-Real-Zone',
        ]);

        $this->assertStringNotContainsString('BEGIN:VTIMEZONE', $ics);
        $this->assertStringNotContainsString('TZID=Not/A-Real-Zone', $ics);
    }

    public function test_update_adds_vtimezone_when_existing_ics_lacked_one(): void
    {
        $existing = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:legacy-tz-1\r\nSUMMARY:Legacy\r\nDTSTART;TZID=Europe/Amsterdam:20260615T100000\r\nDTEND;TZID=Europe/Amsterdam:20260615T110000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->assertStringNotContainsString('BEGIN:VTIMEZONE', $existing);

        $updated = $this->converter->updateVEventInIcs($existing, [
            ...$this->amsterdamEvent(),
            'uid' => 'legacy-tz-1',
            'title' => 'Retitled',
        ], 'legacy-tz-1');

        $this->assertStringContainsString('SUMMARY:Retitled', $updated);
        $this->assertEveryTzidHasVTimeZone($updated);
    }

    public function test_winter_amsterdam_wall_clock_stays_local(): void
    {
        $ics = $this->converter->icsFromEvent([
            '@type' => 'Event',
            'uid' => 'ams-winter-1',
            'title' => 'Winter meeting',
            'start' => '2026-01-15T10:00:00',
            'end' => '2026-01-15T11:00:00',
            'timeZone' => 'Europe/Amsterdam',
        ]);

        $this->assertStringContainsString('DTSTART;TZID=Europe/Amsterdam:20260115T100000', $ics);
        $this->assertEveryTzidHasVTimeZone($ics);
        $this->assertStringContainsString('TZOFFSETTO:+0100', $ics);
    }

    public function test_tokyo_fixed_offset_emits_vtimezone(): void
    {
        $ics = $this->converter->icsFromEvent([
            '@type' => 'Event',
            'uid' => 'tokyo-1',
            'title' => 'Tokyo standup',
            'start' => '2026-06-15T10:00:00',
            'end' => '2026-06-15T10:30:00',
            'timeZone' => 'Asia/Tokyo',
        ]);

        $this->assertStringContainsString('DTSTART;TZID=Asia/Tokyo:20260615T100000', $ics);
        $this->assertEveryTzidHasVTimeZone($ics);
        $this->assertStringContainsString('TZOFFSETTO:+0900', $ics);
    }

    /**
     * @return array<string, mixed>
     */
    private function amsterdamEvent(): array
    {
        return [
            '@type' => 'Event',
            'uid' => 'ams-bare-1',
            'title' => 'Amsterdam catch-up',
            'start' => '2026-06-15T10:00:00',
            'end' => '2026-06-15T11:00:00',
            'timeZone' => 'Europe/Amsterdam',
        ];
    }
}
