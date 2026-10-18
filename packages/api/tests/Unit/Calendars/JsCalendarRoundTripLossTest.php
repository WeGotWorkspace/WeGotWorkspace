<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\Conversion\CalendarConversionSupport;
use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use PHPUnit\Framework\TestCase;

/**
 * Characterization tests for round-trip data loss on CalendarEvent edits.
 *
 * Each test replays the JMAP CalendarEvent/set update path for a single-VEVENT
 * object (CalendarEventMutationSupport::persistEventMutation): read the stored
 * ICS, deep-merge the client patch, normalize, rebuild the ICS. Inputs are what
 * Apple Calendar, Thunderbird and DAVx5 write.
 *
 * These tests pin CURRENT (lossy) behavior so the gaps in
 * docs/architecture/jscalendar-conformance.md stay provable. The fix for a
 * finding (RT-n) flips the matching assertions.
 */
final class JsCalendarRoundTripLossTest extends TestCase
{
    private const BASE = "UID:u1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Orig\r\n"
        ."DTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\n";

    private ICalendarJmapEventConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new ICalendarJmapEventConverter;
    }

    /** RT-1: a plain URL becomes a "WeGotWorkspace Meet" video conference. */
    public function test_rt1_plain_url_is_rewritten_as_wgw_conference(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE."URL;VALUE=URI:https://example.com/agenda\r\n"));

        $this->assertStringContainsString('LABEL=WeGotWorkspace Meet', $out);
        $this->assertStringContainsString('X-GOOGLE-CONFERENCE:https://example.com/agenda', $out);
    }

    /** RT-1: third-party CONFERENCE label/features are overwritten; extra entries are dropped. */
    public function test_rt1_third_party_conference_label_and_dial_in_are_lost(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE
            ."CONFERENCE;VALUE=URI;FEATURE=AUDIO,VIDEO;LABEL=Zoom:https://zoom.us/j/1\r\n"
            ."CONFERENCE;VALUE=URI;FEATURE=PHONE;LABEL=Dial-in:tel:+31201234567\r\n"));

        $this->assertStringNotContainsString('LABEL=Zoom', $out);
        $this->assertStringNotContainsString('tel:+31201234567', $out);
    }

    /** RT-1: the Teams property is replaced by CONFERENCE + X-GOOGLE-CONFERENCE. */
    public function test_rt1_teams_meeting_property_is_replaced(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE
            ."X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/x\r\n"));

        $this->assertStringNotContainsString('X-MICROSOFT-SKYPETEAMSMEETINGURL', $out);
        $this->assertStringContainsString('X-GOOGLE-CONFERENCE:https://teams.microsoft.com/l/x', $out);
    }

    /** RT-2: icsProps keeps one string per name — parameters and repeats are lost. */
    public function test_rt2_unknown_property_parameters_and_repeats_are_lost(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE
            ."X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=Damrak 1;X-APPLE-RADIUS=70;X-TITLE=Office:geo:52.37,4.89\r\n"
            ."IMAGE;VALUE=URI;DISPLAY=BADGE:https://ex.com/i.png\r\n"
            ."COMMENT:first\r\nCOMMENT:second\r\n"));

        $this->assertStringNotContainsString('X-TITLE=Office', $out);
        $this->assertStringContainsString('X-APPLE-STRUCTURED-LOCATION:geo:52.37\,4.89', $out);
        $this->assertStringNotContainsString('DISPLAY=BADGE', $out);
        $this->assertStringNotContainsString('COMMENT:first', $out);
        $this->assertStringContainsString('COMMENT:second', $out);
    }

    /** RT-2: a multi-value list collapses into one escaped text value. */
    public function test_rt2_multi_value_resources_collapse_into_one_value(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE."RESOURCES:Projector,Whiteboard\r\n"));

        $this->assertStringContainsString('RESOURCES:Projector\,Whiteboard', $out);
    }

    /** RT-3: managed-attachment parameters are dropped and inline binaries are corrupted. */
    public function test_rt3_attach_parameters_dropped_and_binary_corrupted(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE
            ."ATTACH;FMTTYPE=application/pdf;FILENAME=a.pdf;SIZE=1234;MANAGED-ID=m1:https://dav.example/att/a.pdf\r\n"
            ."ATTACH;ENCODING=BASE64;VALUE=BINARY;FMTTYPE=text/plain:aGVsbG8=\r\n"));

        $this->assertStringNotContainsString('MANAGED-ID', $out);
        $this->assertStringNotContainsString('FILENAME=a.pdf', $out);
        $this->assertStringNotContainsString('aGVsbG8=', $out);
        $this->assertStringContainsString('ATTACH;FMTTYPE=text/plain:hello', $out);
    }

    /** RT-4: scheduling parameters are dropped; SCHEDULE-AGENT=CLIENT is the dangerous one. */
    public function test_rt4_attendee_and_organizer_scheduling_parameters_are_dropped(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE
            ."ORGANIZER;CN=Org;SENT-BY=\"mailto:assistant@ex.com\";SCHEDULE-AGENT=CLIENT:mailto:org@ex.com\r\n"
            ."ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED;SCHEDULE-STATUS=2.0;SCHEDULE-AGENT=CLIENT;EMAIL=bob@ex.com;X-NUM-GUESTS=2:mailto:bob@ex.com\r\n"));

        $this->assertStringNotContainsString('SCHEDULE-AGENT', $out);
        $this->assertStringNotContainsString('SENT-BY', $out);
        $this->assertStringNotContainsString('SCHEDULE-STATUS', $out);
        $this->assertStringNotContainsString('X-NUM-GUESTS', $out);
    }

    /** RT-4: a non-mailto calendar address gets a mailto: prefix. */
    public function test_rt4_non_mailto_calendar_address_is_corrupted(): void
    {
        $out = $this->unfold($this->patchTitle($this->calendar(self::BASE
            ."ATTENDEE;CN=Room;CUTYPE=ROOM:urn:uuid:11111111-2222-3333-4444-555555555555\r\n")));

        $this->assertStringContainsString('mailto:urn:uuid:11111111-2222-3333-4444-555555555555', $out);
    }

    /** RT-5: VALARM identity, acknowledgement, snooze link and repeat are dropped. */
    public function test_rt5_valarm_uid_acknowledged_snooze_and_repeat_are_dropped(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE
            ."BEGIN:VALARM\r\nUID:A1\r\nX-WR-ALARMUID:A1\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\n"
            ."DESCRIPTION:Event reminder\r\nACKNOWLEDGED:20260615T094600Z\r\nREPEAT:2\r\nDURATION:PT5M\r\n"
            ."X-APPLE-DEFAULT-ALARM:TRUE\r\nEND:VALARM\r\n"
            ."BEGIN:VALARM\r\nUID:A2\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20260615T095500Z\r\n"
            ."RELATED-TO:A1\r\nDESCRIPTION:snooze\r\nEND:VALARM\r\n"));

        foreach (['UID:A1', 'X-WR-ALARMUID', 'ACKNOWLEDGED', 'REPEAT:2', 'RELATED-TO:A1', 'X-APPLE-DEFAULT-ALARM'] as $lost) {
            $this->assertStringNotContainsString($lost, $out, $lost.' is expected to be lost today');
        }
    }

    /** RT-6: DTEND in another zone is rewritten in the DTSTART zone and duration is wrong. */
    public function test_rt6_dtend_time_zone_is_lost_and_duration_is_wrong(): void
    {
        $ics = $this->calendar("UID:u1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Flight\r\n"
            ."DTSTART;TZID=Europe/Amsterdam:20260601T100000\r\n"
            ."DTEND;TZID=America/New_York:20260601T130000\r\n");

        // 10:00 Amsterdam (08:00Z) to 13:00 New York (17:00Z) is nine hours.
        $this->assertSame('PT3H', $this->converter->eventFromIcs($ics)['duration']);
        $this->assertStringContainsString('DTEND;TZID=Europe/Amsterdam:20260601T130000', $this->patchTitle($ics));
    }

    /** RT-7: RDATE disappears when the series also has a RECURRENCE-ID override. */
    public function test_rt7_rdate_is_dropped_when_series_has_override_vevents(): void
    {
        $ics = $this->calendar(self::BASE."RRULE:FREQ=WEEKLY;COUNT=4\r\nRDATE:20260620T100000Z\r\n",
            "BEGIN:VEVENT\r\nUID:u1\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID:20260622T100000Z\r\n"
            ."SUMMARY:Moved\r\nDTSTART:20260622T120000Z\r\nDTEND:20260622T130000Z\r\nEND:VEVENT\r\n");

        $this->assertArrayNotHasKey('2026-06-20T10:00:00Z', $this->converter->eventFromIcs($ics)['recurrenceOverrides']);
        $this->assertStringNotContainsString('RDATE', $this->patchTitle($ics));
    }

    /** RT-8: an override's own alarm, categories and X-props are replaced by the master's. */
    public function test_rt8_override_vevent_extras_are_replaced_by_master_values(): void
    {
        $alarm = static fn (string $trigger): string => "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:{$trigger}\r\nDESCRIPTION:r\r\nEND:VALARM\r\n";
        $ics = $this->calendar(self::BASE."RRULE:FREQ=WEEKLY;COUNT=4\r\n".$alarm('-PT15M'),
            "BEGIN:VEVENT\r\nUID:u1\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID:20260622T100000Z\r\n"
            ."SUMMARY:Moved\r\nDTSTART:20260622T120000Z\r\nDTEND:20260622T130000Z\r\n"
            ."X-OVERRIDE-NOTE:keep\r\nCATEGORIES:Special\r\n".$alarm('-PT5M')."END:VEVENT\r\n");

        $out = $this->patchTitle($ics);

        $this->assertStringNotContainsString('X-OVERRIDE-NOTE', $out);
        $this->assertStringNotContainsString('CATEGORIES:Special', $out);
        $this->assertStringNotContainsString('TRIGGER:-PT5M', $out);
        $this->assertSame(2, substr_count($out, 'TRIGGER:-PT15M'));
    }

    /** RT-9: calendar-level properties are dropped because single-VEVENT edits rebuild the document. */
    public function test_rt9_vcalendar_level_properties_are_dropped(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN\r\n"
            ."CALSCALE:GREGORIAN\r\nX-WR-TIMEZONE:Europe/Amsterdam\r\n"
            ."BEGIN:VEVENT\r\n".self::BASE."END:VEVENT\r\nEND:VCALENDAR\r\n";

        $out = $this->patchTitle($ics);

        $this->assertStringNotContainsString('X-WR-TIMEZONE', $out);
        $this->assertStringNotContainsString('CALSCALE', $out);
        $this->assertStringContainsString('PRODID:-//WeGotWorkspace//Calendars REST//EN', $out);
    }

    /** RT-10: sending a map without an entry does not remove that entry. */
    public function test_rt10_removing_an_alert_or_participant_from_the_map_is_ignored(): void
    {
        $ics = $this->calendar(self::BASE
            ."ATTENDEE;CN=A:mailto:a@ex.com\r\nATTENDEE;CN=B:mailto:b@ex.com\r\n"
            ."BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:r\r\nEND:VALARM\r\n"
            ."BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1H\r\nDESCRIPTION:r\r\nEND:VALARM\r\n");
        $event = $this->converter->eventFromIcs($ics);

        $out = $this->patch($ics, [
            'alerts' => ['alert1' => $event['alerts']['alert1']],
            'participants' => ['att1' => $event['participants']['att1']],
        ]);

        $this->assertStringContainsString('TRIGGER:-PT1H', $out);
        $this->assertStringContainsString('mailto:b@ex.com', $out);
    }

    /** RT-10: RFC 8620 PatchObject pointer paths are ignored. */
    public function test_rt10_patch_object_pointer_paths_are_ignored(): void
    {
        $ics = $this->calendar(self::BASE
            ."BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:r\r\nEND:VALARM\r\n"
            ."BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1H\r\nDESCRIPTION:r\r\nEND:VALARM\r\n");

        $this->assertStringContainsString('TRIGGER:-PT1H', $this->patch($ics, ['alerts/alert2' => null]));
    }

    /** RT-11: RFC 8984 color is never written; COLOR is only read into icsProps. */
    public function test_rt11_color_is_not_mapped(): void
    {
        $ics = $this->calendar(self::BASE."COLOR:turquoise\r\n");
        $event = $this->converter->eventFromIcs($ics);

        $this->assertArrayNotHasKey('color', $event);
        $this->assertSame('turquoise', $event['icsProps']['COLOR']);

        unset($event['icsProps']);
        $event['color'] = 'red';
        $this->assertStringNotContainsString('COLOR', $this->converter->icsFromEvent(
            CalendarConversionSupport::normalizeEventMapKeys($event),
        ));
    }

    private function calendar(string $masterBody, string $extraComponents = ''): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//macOS 26.0//EN\r\n"
            ."BEGIN:VEVENT\r\n".$masterBody."END:VEVENT\r\n".$extraComponents."END:VCALENDAR\r\n";
    }

    private function patchTitle(string $ics): string
    {
        return $this->patch($ics, ['title' => 'Renamed']);
    }

    /**
     * Mirrors persistEventMutation(deepMerge: true) for a single-VEVENT object.
     *
     * @param  array<string, mixed>  $patch
     */
    private function patch(string $ics, array $patch): string
    {
        $existing = $this->converter->eventFromIcs($ics);
        $merged = CalendarConversionSupport::normalizeEventMapKeys(
            CalendarConversionSupport::deepMergeEventPatch($existing, $patch),
            $existing,
        );

        return $this->converter->icsFromEvent($merged);
    }

    private function unfold(string $ics): string
    {
        return str_replace("\r\n ", '', $ics);
    }
}
