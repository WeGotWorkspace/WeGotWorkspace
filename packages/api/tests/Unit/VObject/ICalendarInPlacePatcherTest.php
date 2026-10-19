<?php

declare(strict_types=1);

namespace Tests\Unit\VObject;

use App\Services\VObject\ICalendarInPlacePatcher;
use PHPUnit\Framework\TestCase;

final class ICalendarInPlacePatcherTest extends TestCase
{
    public function test_changed_property_takes_the_generated_lines_and_keeps_the_rest(): void
    {
        $stored = $this->cal("SUMMARY;LANGUAGE=nl:Oud\r\nX-KEEP;P=1:yes\r\nLOCATION;ALTREP=\"cid:x\":Room\r\n");
        $baseline = $this->cal("SUMMARY:Oud\r\nLOCATION:Room\r\n");
        $generated = $this->cal("SUMMARY:Nieuw\r\nLOCATION:Room\r\n");

        $out = ICalendarInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertStringContainsString("SUMMARY:Nieuw\r\n", $out);
        $this->assertStringNotContainsString('Oud', $out);
        $this->assertStringContainsString("X-KEEP;P=1:yes\r\n", $out);
        $this->assertStringContainsString("LOCATION;ALTREP=\"cid:x\":Room\r\n", $out);
    }

    public function test_property_removed_by_the_edit_is_removed(): void
    {
        $stored = $this->cal("SUMMARY:A\r\nDESCRIPTION;X-P=1:Old notes\r\n");
        $baseline = $this->cal("SUMMARY:A\r\nDESCRIPTION:Old notes\r\n");
        $generated = $this->cal("SUMMARY:A\r\n");

        $out = ICalendarInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertStringNotContainsString('DESCRIPTION', $out);
    }

    public function test_deleted_override_is_removed_and_new_override_is_added(): void
    {
        $override = static fn (string $rid, string $extra = ''): string => "BEGIN:VEVENT\r\nUID:u1\r\nRECURRENCE-ID:{$rid}\r\nSUMMARY:O\r\n{$extra}END:VEVENT\r\n";
        $stored = $this->cal("SUMMARY:A\r\nRRULE:FREQ=DAILY;COUNT=5\r\n", $override('20260602T100000Z', "X-V:1\r\n"));
        $baseline = $this->cal("SUMMARY:A\r\nRRULE:FREQ=DAILY;COUNT=5\r\n", $override('20260602T100000Z'));
        $generated = $this->cal("SUMMARY:A\r\nRRULE:FREQ=DAILY;COUNT=5\r\n", $override('20260603T100000Z'));

        $out = ICalendarInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertStringNotContainsString('20260602T100000Z', $out);
        $this->assertStringContainsString('RECURRENCE-ID:20260603T100000Z', $out);
        $this->assertSame(2, substr_count($out, 'BEGIN:VEVENT'));
    }

    public function test_other_events_and_unknown_components_in_the_object_are_untouched(): void
    {
        $other = "BEGIN:VEVENT\r\nUID:u2\r\nSUMMARY;X-P=1:Other\r\nEND:VEVENT\r\nBEGIN:X-VENDOR\r\nX-A:1\r\nEND:X-VENDOR\r\n";
        $stored = $this->cal("SUMMARY:A\r\n", $other);
        $baseline = $this->cal("SUMMARY:A\r\n", "BEGIN:VEVENT\r\nUID:u2\r\nSUMMARY:Other\r\nEND:VEVENT\r\n");
        $generated = $this->cal("SUMMARY:B\r\n", "BEGIN:VEVENT\r\nUID:u2\r\nSUMMARY:Other\r\nEND:VEVENT\r\n");

        $out = ICalendarInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertStringContainsString("SUMMARY:B\r\n", $out);
        $this->assertStringContainsString("SUMMARY;X-P=1:Other\r\n", $out);
        $this->assertStringContainsString("BEGIN:X-VENDOR\r\nX-A:1\r\nEND:X-VENDOR\r\n", $out);
    }

    public function test_missing_time_zone_is_added_and_stored_ones_are_kept(): void
    {
        $zone = static fn (string $tzid, string $marker): string => "BEGIN:VTIMEZONE\r\nTZID:{$tzid}\r\nX-MARK:{$marker}\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0100\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";
        $stored = $this->cal("SUMMARY:A\r\n", $zone('Europe/Amsterdam', 'client'));
        $baseline = $this->cal("SUMMARY:A\r\n", $zone('Europe/Amsterdam', 'wgw'));
        $generated = $this->cal("SUMMARY:A\r\nDTSTART;TZID=Asia/Tokyo:20260601T100000\r\n", $zone('Europe/Amsterdam', 'wgw').$zone('Asia/Tokyo', 'wgw'));

        $out = ICalendarInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertStringContainsString('X-MARK:client', $out);
        $this->assertSame(1, substr_count($out, 'TZID:Europe/Amsterdam'));
        $this->assertSame(1, substr_count($out, "TZID:Asia/Tokyo\r\n"));
    }

    private function cal(string $masterBody, string $extra = ''): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:u1\r\n".$masterBody."END:VEVENT\r\n".$extra."END:VCALENDAR\r\n";
    }
}
