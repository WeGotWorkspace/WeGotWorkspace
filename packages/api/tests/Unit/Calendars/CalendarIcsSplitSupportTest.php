<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\Conversion\CalendarIcsSplitSupport;
use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use App\Services\Calendars\Conversion\RecurrenceOverrideSupport;
use PHPUnit\Framework\TestCase;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Reader;

final class CalendarIcsSplitSupportTest extends TestCase
{
    public function test_groups_vevents_by_uid_and_keeps_referenced_timezone(): void
    {
        $ics = <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Europe/Vienna
BEGIN:STANDARD
DTSTART:19701025T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:series-1
DTSTART;TZID=Europe/Vienna:20260105T100000
DTEND;TZID=Europe/Vienna:20260105T110000
RRULE:FREQ=WEEKLY
SUMMARY:Weekly
END:VEVENT
BEGIN:VEVENT
UID:series-1
RECURRENCE-ID;TZID=Europe/Vienna:20260112T100000
DTSTART;TZID=Europe/Vienna:20260112T120000
DTEND;TZID=Europe/Vienna:20260112T130000
SUMMARY:Weekly moved
END:VEVENT
BEGIN:VEVENT
UID:solo-1
DTSTART:20260201T090000Z
DTEND:20260201T100000Z
SUMMARY:Solo
END:VEVENT
END:VCALENDAR
ICS;

        $groups = CalendarIcsSplitSupport::splitUidGroups($ics);

        $this->assertCount(2, $groups);
        $byUid = [];
        foreach ($groups as $group) {
            $byUid[$group['uid']] = $group['ics'];
        }

        $this->assertArrayHasKey('series-1', $byUid);
        $this->assertArrayHasKey('solo-1', $byUid);
        $this->assertStringContainsString('SUMMARY:Weekly', $byUid['series-1']);
        $this->assertStringContainsString('RECURRENCE-ID', $byUid['series-1']);
        $this->assertStringContainsString('BEGIN:VTIMEZONE', $byUid['series-1']);
        $this->assertStringContainsString('SUMMARY:Solo', $byUid['solo-1']);
        $this->assertStringNotContainsString('BEGIN:VTIMEZONE', $byUid['solo-1']);
    }

    public function test_skips_vtodo_and_vjournal(): void
    {
        $ics = <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:todo-1
SUMMARY:A task
END:VTODO
BEGIN:VJOURNAL
UID:journal-1
SUMMARY:A journal
END:VJOURNAL
BEGIN:VEVENT
UID:event-1
DTSTART:20260301T090000Z
DTEND:20260301T100000Z
SUMMARY:An event
END:VEVENT
END:VCALENDAR
ICS;

        $groups = CalendarIcsSplitSupport::splitUidGroups($ics);

        $this->assertCount(1, $groups);
        $this->assertSame('event-1', $groups[0]['uid']);
        $this->assertStringContainsString('SUMMARY:An event', $groups[0]['ics']);
        $this->assertStringNotContainsString('VTODO', $groups[0]['ics']);
        $this->assertStringNotContainsString('VJOURNAL', $groups[0]['ics']);
    }

    public function test_returns_empty_when_no_vevent(): void
    {
        $ics = <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:todo-only
SUMMARY:Only a task
END:VTODO
END:VCALENDAR
ICS;

        $this->assertSame([], CalendarIcsSplitSupport::splitUidGroups($ics));
    }

    public function test_unreadable_ics_throws(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        CalendarIcsSplitSupport::splitUidGroups('this is not ics');
    }

    public function test_orphan_recurrence_id_is_one_standalone_group(): void
    {
        $ics = <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:orphan-1
RECURRENCE-ID:20260108T100000Z
DTSTART:20260108T120000Z
DTEND:20260108T130000Z
SUMMARY:Orphan override
END:VEVENT
END:VCALENDAR
ICS;

        $groups = CalendarIcsSplitSupport::splitUidGroups($ics);
        $this->assertCount(1, $groups);
        $this->assertSame('orphan-1', $groups[0]['uid']);
        $this->assertStringContainsString('RECURRENCE-ID', $groups[0]['ics']);

        $document = Reader::read($groups[0]['ics']);
        $this->assertInstanceOf(VCalendar::class, $document);
        $vevents = [];
        foreach ($document->select('VEVENT') as $component) {
            if ($component instanceof VEvent) {
                $vevents[] = $component;
            }
        }
        $series = RecurrenceOverrideSupport::groupRecurrenceSeries($vevents);
        $this->assertCount(1, $series);
        $this->assertSame([], $series[0]['overrides']);
        $this->assertTrue(isset($series[0]['master']->{'RECURRENCE-ID'}));

        $events = (new ICalendarJmapEventConverter)->eventsFromIcs($groups[0]['ics']);
        $this->assertCount(1, $events);
        $this->assertSame('Orphan override', $events[0]['title'] ?? null);
        $this->assertArrayNotHasKey('recurrenceRules', $events[0]);
    }
}
