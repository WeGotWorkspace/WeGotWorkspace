<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Models\CalendarInstance;
use App\Services\Calendars\CalendarFeedIcsBuilder;
use Tests\Support\AssertsIcsTimeZones;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #608: the public feed must repair stored ICS that has TZID but no VTIMEZONE.
 */
final class CalendarFeedIcsTimezoneTest extends WgwDatabaseTestCase
{
    use AssertsIcsTimeZones;
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_feed_repairs_legacy_tzid_without_vtimezone(): void
    {
        $this->seedEventViaPdo('bob', 'legacy-ams.ics', $this->legacyAmsterdamIcs('legacy-ams@example.test'));

        $feed = (new CalendarFeedIcsBuilder)->build($this->bobDefaultInstance());
        $this->assertStringContainsString('UID:legacy-ams@example.test', $feed);
        $this->assertStringContainsString('DTSTART;TZID=Europe/Amsterdam:20260615T100000', $feed);
        $this->assertEveryTzidHasVTimeZone($feed);
    }

    public function test_feed_passthroughs_existing_vtimezone_and_dedupes(): void
    {
        $this->seedEventViaPdo('bob', 'with-tz.ics', $this->amsterdamIcsWithVTimeZone('with-tz@example.test'));
        $this->seedEventViaPdo('bob', 'also-tz.ics', $this->amsterdamIcsWithVTimeZone('also-tz@example.test'));

        $feed = (new CalendarFeedIcsBuilder)->build($this->bobDefaultInstance());
        $this->assertEveryTzidHasVTimeZone($feed);
        $this->assertSame(1, substr_count($feed, 'BEGIN:VTIMEZONE'));
        $this->assertStringContainsString('UID:with-tz@example.test', $feed);
        $this->assertStringContainsString('UID:also-tz@example.test', $feed);
    }

    public function test_feed_emits_vtimezone_per_referenced_tzid(): void
    {
        $this->seedEventViaPdo('bob', 'ams.ics', $this->legacyAmsterdamIcs('ams@example.test'));
        $this->seedEventViaPdo('bob', 'nyc.ics', $this->legacyNewYorkIcs('nyc@example.test'));

        $feed = (new CalendarFeedIcsBuilder)->build($this->bobDefaultInstance());
        $this->assertEveryTzidHasVTimeZone($feed);
        $this->assertContains('Europe/Amsterdam', $this->tzidsDefinedInIcs($feed));
        $this->assertContains('America/New_York', $this->tzidsDefinedInIcs($feed));
    }

    public function test_utc_feed_events_do_not_get_a_vtimezone(): void
    {
        $this->seedEventViaPdo('bob', 'utc.ics', $this->sampleIcs('UTC Meeting', 'utc@example.test'));

        $feed = (new CalendarFeedIcsBuilder)->build($this->bobDefaultInstance());
        $this->assertStringContainsString('UID:utc@example.test', $feed);
        $this->assertEveryTzidHasVTimeZone($feed);
    }

    private function bobDefaultInstance(): CalendarInstance
    {
        $instance = CalendarInstance::query()
            ->where('principaluri', 'principals/bob')
            ->where('uri', 'default')
            ->first();
        $this->assertNotNull($instance);

        return $instance;
    }

    private function legacyAmsterdamIcs(string $uid): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:Legacy Amsterdam\r\nDTSTART;TZID=Europe/Amsterdam:20260615T100000\r\nDTEND;TZID=Europe/Amsterdam:20260615T110000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function legacyNewYorkIcs(string $uid): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:Legacy New York\r\nDTSTART;TZID=America/New_York:20260615T100000\r\nDTEND;TZID=America/New_York:20260615T110000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function amsterdamIcsWithVTimeZone(string $uid): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Amsterdam\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:With zone\r\nDTSTART;TZID=Europe/Amsterdam:20260615T100000\r\nDTEND;TZID=Europe/Amsterdam:20260615T110000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }
}
