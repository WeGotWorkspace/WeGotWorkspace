<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarSchedulingInviteHorizon;
use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\TestCase;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Reader;

final class CalendarSchedulingInviteHorizonTest extends TestCase
{
    private CalendarSchedulingInviteHorizon $horizon;

    private DateTimeImmutable $now;

    protected function setUp(): void
    {
        parent::setUp();
        $this->horizon = new CalendarSchedulingInviteHorizon;
        $this->now = new DateTimeImmutable('2026-08-19T12:00:00Z', new DateTimeZone('UTC'));
    }

    public function test_past_one_off_is_fully_past(): void
    {
        $this->assertFalse($this->continuesAfter(
            "DTSTART:20260115T100000Z\r\nDTEND:20260115T103000Z\r\n",
        ));
    }

    public function test_future_one_off_continues(): void
    {
        $this->assertTrue($this->continuesAfter(
            "DTSTART:20300115T100000Z\r\nDTEND:20300115T103000Z\r\n",
        ));
    }

    public function test_one_off_in_progress_continues(): void
    {
        $this->assertTrue($this->continuesAfter(
            "DTSTART:20260819T110000Z\r\nDTEND:20260819T130000Z\r\n",
        ));
    }

    public function test_one_off_just_ended_is_fully_past(): void
    {
        $this->assertFalse($this->continuesAfter(
            "DTSTART:20260819T110000Z\r\nDTEND:20260819T120000Z\r\n",
        ));
    }

    public function test_one_off_without_dtend_uses_dtstart(): void
    {
        $this->assertFalse($this->continuesAfter("DTSTART:20260819T110000Z\r\n"));
        $this->assertTrue($this->continuesAfter("DTSTART:20260819T130000Z\r\n"));
    }

    public function test_all_day_today_continues_until_exclusive_dtend(): void
    {
        $this->assertTrue($this->continuesAfter(
            "DTSTART;VALUE=DATE:20260819\r\nDTEND;VALUE=DATE:20260820\r\n",
        ));
        $this->assertFalse($this->continuesAfter(
            "DTSTART;VALUE=DATE:20260818\r\nDTEND;VALUE=DATE:20260819\r\n",
        ));
    }

    public function test_recurring_with_future_instances_continues(): void
    {
        $this->assertTrue($this->continuesAfter(
            "DTSTART:20200115T100000Z\r\nDTEND:20200115T103000Z\r\n"
            ."RRULE:FREQ=WEEKLY;UNTIL=20301231T100000Z\r\n",
        ));
    }

    public function test_recurring_count_exhausted_is_fully_past(): void
    {
        $this->assertFalse($this->continuesAfter(
            "DTSTART:20200115T100000Z\r\nDTEND:20200115T103000Z\r\n"
            ."RRULE:FREQ=WEEKLY;COUNT=3\r\n",
        ));
    }

    public function test_recurring_until_exhausted_is_fully_past(): void
    {
        $this->assertFalse($this->continuesAfter(
            "DTSTART:20200115T100000Z\r\nDTEND:20200115T103000Z\r\n"
            ."RRULE:FREQ=WEEKLY;UNTIL=20200201T100000Z\r\n",
        ));
    }

    public function test_recurring_current_instance_still_running_continues(): void
    {
        $this->assertTrue($this->continuesAfter(
            "DTSTART:20260819T110000Z\r\nDTEND:20260819T130000Z\r\n"
            ."RRULE:FREQ=DAILY;COUNT=2\r\n",
        ));
    }

    private function continuesAfter(string $eventBody): bool
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:horizon-1\r\n"
            ."SUMMARY:Invite\r\n{$eventBody}END:VEVENT\r\nEND:VCALENDAR\r\n";
        $vcal = Reader::read($ics);
        $vevent = $vcal->VEVENT ?? null;
        $this->assertInstanceOf(VEvent::class, $vevent);

        return $this->horizon->continuesAfter($vevent, $this->now);
    }
}
