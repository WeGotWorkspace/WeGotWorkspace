<?php

declare(strict_types=1);

namespace Tests\Unit\VObject;

use App\Services\VObject\ICalendarUidGroupSplitter;
use PHPUnit\Framework\TestCase;

final class ICalendarUidGroupSplitterTest extends TestCase
{
    private const MIXED = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
        ."BEGIN:VTIMEZONE\r\nTZID:Europe/Amsterdam\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n"
        ."BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nBEGIN:STANDARD\r\nDTSTART:19701101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n"
        ."BEGIN:VEVENT\r\nUID:event-1\r\nSUMMARY:Event\r\nDTSTART;TZID=America/New_York:20261101T090000\r\nEND:VEVENT\r\n"
        ."BEGIN:VEVENT\r\nUID:event-2\r\nSUMMARY:Series\r\nDTSTART:20261101T090000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\n"
        ."BEGIN:VEVENT\r\nUID:event-2\r\nRECURRENCE-ID:20261102T090000Z\r\nSUMMARY:Moved\r\nDTSTART:20261102T100000Z\r\nEND:VEVENT\r\n"
        ."BEGIN:VTODO\r\nUID:todo-1\r\nSUMMARY:Due in Amsterdam\r\nDUE;TZID=Europe/Amsterdam:20261110T170000\r\nEND:VTODO\r\n"
        ."BEGIN:VTODO\r\nUID:todo-2\r\nSUMMARY:Plain\r\nEND:VTODO\r\n"
        ."BEGIN:VJOURNAL\r\nUID:journal-1\r\nSUMMARY:Note\r\nEND:VJOURNAL\r\n"
        ."END:VCALENDAR\r\n";

    public function test_vtodo_groups_keep_due_time_zone_and_count_other_components(): void
    {
        $split = ICalendarUidGroupSplitter::split(self::MIXED, 'VTODO');

        $this->assertSame(['todo-1', 'todo-2'], array_column($split['groups'], 'uid'));
        $this->assertStringContainsString('TZID:Europe/Amsterdam', $split['groups'][0]['ics']);
        $this->assertStringNotContainsString('America/New_York', $split['groups'][0]['ics']);
        $this->assertStringNotContainsString('VTIMEZONE', $split['groups'][1]['ics']);
        $this->assertStringNotContainsString('VEVENT', $split['groups'][0]['ics'].$split['groups'][1]['ics']);
        $this->assertSame(['VEVENT' => 2, 'VJOURNAL' => 1], $split['skipped']);
    }

    public function test_vevent_groups_count_tasks_as_skipped(): void
    {
        $split = ICalendarUidGroupSplitter::split(self::MIXED, 'VEVENT');

        $this->assertSame(['event-1', 'event-2'], array_column($split['groups'], 'uid'));
        $this->assertStringContainsString('TZID:America/New_York', $split['groups'][0]['ics']);
        $this->assertSame(2, substr_count($split['groups'][1]['ics'], 'BEGIN:VEVENT'));
        $this->assertSame(['VTODO' => 2, 'VJOURNAL' => 1], $split['skipped']);
    }

    public function test_vtodo_time_zones_on_dtstart_and_completed_are_kept(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            ."BEGIN:VTIMEZONE\r\nTZID:Zone-Start\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0000\r\nTZOFFSETTO:+0000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n"
            ."BEGIN:VTIMEZONE\r\nTZID:Zone-Done\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0000\r\nTZOFFSETTO:+0000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n"
            ."BEGIN:VTODO\r\nUID:t\r\nDTSTART;TZID=Zone-Start:20261101T090000\r\nCOMPLETED;TZID=Zone-Done:20261102T090000\r\nEND:VTODO\r\n"
            ."END:VCALENDAR\r\n";

        $group = ICalendarUidGroupSplitter::split($ics, 'VTODO')['groups'][0]['ics'];

        $this->assertStringContainsString('TZID:Zone-Start', $group);
        $this->assertStringContainsString('TZID:Zone-Done', $group);
    }

    public function test_missing_uid_gets_a_stable_seeded_group_key(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nSUMMARY:No uid\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";

        $first = ICalendarUidGroupSplitter::split($ics, 'VTODO')['groups'];
        $second = ICalendarUidGroupSplitter::split($ics, 'VTODO')['groups'];

        $this->assertCount(1, $first);
        $this->assertNotSame('', $first[0]['uid']);
        $this->assertSame($first[0]['uid'], $second[0]['uid']);
    }

    public function test_unreadable_text_throws(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        ICalendarUidGroupSplitter::split('not ics', 'VTODO');
    }
}
