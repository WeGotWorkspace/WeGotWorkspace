<?php

declare(strict_types=1);

namespace Tests\Unit\VObject;

use App\Services\VObject\ICalendarDateList;
use App\Services\VObject\ICalendarDateTime;
use App\Services\VObject\ICalendarUid;
use PHPUnit\Framework\TestCase;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Reader;

final class ICalendarDateTimeTest extends TestCase
{
    public function test_to_jmap_parses_compact_ics_via_sabre(): void
    {
        $this->assertSame('2026-06-15T10:00:00Z', ICalendarDateTime::toJmap('20260615T100000Z'));
        $this->assertSame('2026-06-15T10:00:00', ICalendarDateTime::toJmap('20260615T100000'));
        $this->assertSame('2026-07-04', ICalendarDateTime::toJmap('20260704'));
    }

    public function test_to_jmap_passes_through_already_hyphenated_values(): void
    {
        $this->assertSame('2026-06-15T10:00:00Z', ICalendarDateTime::toJmap('2026-06-15T10:00:00Z'));
        $this->assertSame('2026-07-04', ICalendarDateTime::toJmap('2026-07-04'));
    }

    public function test_to_ics_round_trips_jmap_local_and_utc(): void
    {
        $this->assertSame('20260615T100000Z', ICalendarDateTime::toIcs('2026-06-15T10:00:00Z'));
        $this->assertSame('20260615T100000', ICalendarDateTime::toIcs('2026-06-15T10:00:00'));
        $this->assertSame('20260704', ICalendarDateTime::toIcs('2026-07-04'));
    }

    public function test_from_property_uses_sabre_datetime_json_value(): void
    {
        $calendar = new VCalendar;
        $event = $calendar->add('VEVENT', []);
        $event->add('DTSTART', '20260615T100000Z');
        $event->add('DTEND', '20260615T110000Z');

        $start = ICalendarDateTime::fromProperty($event->DTSTART);
        $this->assertSame('2026-06-15T10:00:00Z', $start['value']);
        $this->assertFalse($start['showWithoutTime']);
        $this->assertNull($start['timeZone']);
    }

    public function test_from_property_all_day_and_tzid(): void
    {
        $calendar = new VCalendar;
        $event = $calendar->add('VEVENT', []);
        $event->add('DTSTART', '20260704', ['VALUE' => 'DATE']);
        $event->add('DTEND', '20260810T140000', ['TZID' => 'Europe/Amsterdam']);

        $allDay = ICalendarDateTime::fromProperty($event->DTSTART);
        $this->assertSame('2026-07-04', $allDay['value']);
        $this->assertTrue($allDay['showWithoutTime']);

        $timed = ICalendarDateTime::fromProperty($event->DTEND);
        $this->assertSame('2026-08-10T14:00:00', $timed['value']);
        $this->assertSame('Europe/Amsterdam', $timed['timeZone']);
    }

    public function test_write_property_utc_identifier_uses_z_not_tzid(): void
    {
        $calendar = new VCalendar;
        $event = $calendar->add('VEVENT', []);
        ICalendarDateTime::writeProperty($event, 'DTSTART', '2026-06-15T10:00:00', false, 'UTC');

        $this->assertSame('20260615T100000Z', (string) $event->DTSTART);
        $this->assertFalse(isset($event->DTSTART['TZID']));
    }

    public function test_write_property_skips_unknown_tzid(): void
    {
        $calendar = new VCalendar;
        $event = $calendar->add('VEVENT', []);
        ICalendarDateTime::writeProperty($event, 'DTSTART', '2026-06-15T10:00:00', false, 'Not/A-Real-Zone');

        $this->assertSame('20260615T100000', (string) $event->DTSTART);
        $this->assertFalse(isset($event->DTSTART['TZID']));
    }

    public function test_exdate_list_uses_sabre_multi_value_not_comma_split(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20260601T080000Z\r\nEXDATE:20260608T080000Z,20260615T080000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $calendar = Reader::read($ics);
        $this->assertInstanceOf(VCalendar::class, $calendar);

        $this->assertSame(
            ['2026-06-08T08:00:00Z', '2026-06-15T08:00:00Z'],
            ICalendarDateList::jmapValuesFromProperty($calendar->VEVENT->EXDATE),
        );
    }

    public function test_uid_from_seed_is_stable(): void
    {
        $this->assertSame(
            ICalendarUid::fromSeed('missing-uid'),
            ICalendarUid::fromSeed('missing-uid'),
        );
        $this->assertStringStartsWith('urn:uuid:', ICalendarUid::fromSeed('missing-uid'));
    }
}
