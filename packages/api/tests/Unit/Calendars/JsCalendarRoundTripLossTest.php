<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Exceptions\ApiHttpException;
use App\Services\Calendars\Conversion\CalendarConversionSupport;
use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use App\Services\VObject\ICalendarInPlacePatcher;
use PHPUnit\Framework\TestCase;

/**
 * Characterization tests for round-trip data loss on CalendarEvent edits.
 *
 * Each test replays the JMAP CalendarEvent/set update path for a single-VEVENT
 * object (CalendarEventMutationSupport::persistEventMutation): read the stored
 * ICS, deep-merge the client patch, normalize, render, patch the stored ICS in place. Inputs are what
 * Apple Calendar, Thunderbird and DAVx5 write.
 *
 * Tests named `*_survive_*` pin a finding that #1392 fixed for unrelated
 * edits. The rest pin CURRENT (lossy) behavior so the gaps in
 * docs/architecture/jscalendar-conformance.md stay provable; the fix for a
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

    /** RT-1 (fixed for unrelated edits by #1392): a plain URL stays a link. */
    public function test_rt1_plain_url_survives_a_title_edit(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE."URL;VALUE=URI:https://example.com/agenda\r\n"));

        $this->assertStringContainsString("URL;VALUE=URI:https://example.com/agenda\r\n", $out);
        $this->assertStringNotContainsString('CONFERENCE', $out);
    }

    /** RT-1 (fixed for unrelated edits by #1392): third-party CONFERENCE entries keep label and dial-in. */
    public function test_rt1_third_party_conferences_survive_a_title_edit(): void
    {
        $out = $this->unfold($this->patchTitle($this->calendar(self::BASE
            ."CONFERENCE;VALUE=URI;FEATURE=AUDIO,VIDEO;LABEL=Zoom:https://zoom.us/j/1\r\n"
            ."CONFERENCE;VALUE=URI;FEATURE=PHONE;LABEL=Dial-in:tel:+31201234567\r\n")));

        $this->assertStringContainsString('LABEL=Zoom:https://zoom.us/j/1', $out);
        $this->assertStringContainsString('LABEL=Dial-in:tel:+31201234567', $out);
        $this->assertStringNotContainsString('WeGotWorkspace Meet', $out);
    }

    /** RT-1 (fixed for unrelated edits by #1392): the Teams property is kept as written. */
    public function test_rt1_teams_meeting_property_survives_a_title_edit(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE
            ."X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/x\r\n"));

        $this->assertStringContainsString('X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/x', $out);
        $this->assertStringNotContainsString('X-GOOGLE-CONFERENCE', $out);
    }

    /** RT-2 (fixed by #1392): unknown properties keep parameters and repeats. */
    public function test_rt2_unknown_properties_survive_a_title_edit(): void
    {
        $out = $this->unfold($this->patchTitle($this->calendar(self::BASE
            ."X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=Damrak 1;X-APPLE-RADIUS=70;X-TITLE=Office:geo:52.37,4.89\r\n"
            ."IMAGE;VALUE=URI;DISPLAY=BADGE:https://ex.com/i.png\r\n"
            ."COMMENT:first\r\nCOMMENT:second\r\n")));

        // Parameters survive. Sabre still re-escapes the comma in this URI value
        // when it re-serializes the stored document; that is a separate gap.
        $this->assertStringContainsString('X-ADDRESS=Damrak 1;X-APPLE-RADIUS=70;X-TITLE=Office:geo:52.37\\,4.89', $out);
        $this->assertStringContainsString('DISPLAY=BADGE', $out);
        $this->assertStringContainsString("COMMENT:first\r\n", $out);
        $this->assertStringContainsString("COMMENT:second\r\n", $out);
    }

    /** RT-2 (fixed by #1392): a multi-value list keeps its values. */
    public function test_rt2_multi_value_resources_survive_a_title_edit(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE."RESOURCES:Projector,Whiteboard\r\n"));

        $this->assertStringContainsString("RESOURCES:Projector,Whiteboard\r\n", $out);
    }

    /** RT-3 (fixed for unrelated edits by #1392): attachments keep parameters and binary content. */
    public function test_rt3_attachments_survive_a_title_edit(): void
    {
        $out = $this->unfold($this->patchTitle($this->calendar(self::BASE
            ."ATTACH;FMTTYPE=application/pdf;FILENAME=a.pdf;SIZE=1234;MANAGED-ID=m1:https://dav.example/att/a.pdf\r\n"
            ."ATTACH;ENCODING=BASE64;VALUE=BINARY;FMTTYPE=text/plain:aGVsbG8=\r\n")));

        $this->assertStringContainsString('MANAGED-ID=m1', $out);
        $this->assertStringContainsString('FILENAME=a.pdf', $out);
        $this->assertStringContainsString('aGVsbG8=', $out);
    }

    /** RT-4 (fixed for unrelated edits by #1392): scheduling parameters survive. */
    public function test_rt4_scheduling_parameters_survive_a_title_edit(): void
    {
        $out = $this->unfold($this->patchTitle($this->calendar(self::BASE
            ."ORGANIZER;CN=Org;SENT-BY=\"mailto:assistant@ex.com\";SCHEDULE-AGENT=CLIENT:mailto:org@ex.com\r\n"
            ."ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED;SCHEDULE-STATUS=2.0;SCHEDULE-AGENT=CLIENT;EMAIL=bob@ex.com;X-NUM-GUESTS=2:mailto:bob@ex.com\r\n")));

        $this->assertSame(2, substr_count($out, 'SCHEDULE-AGENT=CLIENT'));
        $this->assertStringContainsString('SENT-BY=', $out);
        $this->assertStringContainsString('SCHEDULE-STATUS=2.0', $out);
        $this->assertStringContainsString('X-NUM-GUESTS=2', $out);
    }

    /** RT-4 (fixed for unrelated edits by #1392): a non-mailto calendar address is kept as written. */
    public function test_rt4_non_mailto_calendar_address_survives_a_title_edit(): void
    {
        $out = $this->unfold($this->patchTitle($this->calendar(self::BASE
            ."ATTENDEE;CN=Room;CUTYPE=ROOM:urn:uuid:11111111-2222-3333-4444-555555555555\r\n")));

        $this->assertStringContainsString(':urn:uuid:11111111-2222-3333-4444-555555555555', $out);
        $this->assertStringNotContainsString('mailto:urn:uuid', $out);
    }

    /** RT-5 (fixed for unrelated edits by #1392): alarms keep identity, acknowledgement, snooze and repeat. */
    public function test_rt5_alarms_survive_a_title_edit(): void
    {
        $out = $this->patchTitle($this->calendar(self::BASE
            ."BEGIN:VALARM\r\nUID:A1\r\nX-WR-ALARMUID:A1\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\n"
            ."DESCRIPTION:Event reminder\r\nACKNOWLEDGED:20260615T094600Z\r\nREPEAT:2\r\nDURATION:PT5M\r\n"
            ."X-APPLE-DEFAULT-ALARM:TRUE\r\nEND:VALARM\r\n"
            ."BEGIN:VALARM\r\nUID:A2\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20260615T095500Z\r\n"
            ."RELATED-TO:A1\r\nDESCRIPTION:snooze\r\nEND:VALARM\r\n"));

        foreach (["UID:A1\r\n", 'X-WR-ALARMUID:A1', 'ACKNOWLEDGED:20260615T094600Z', 'REPEAT:2', 'RELATED-TO:A1', 'X-APPLE-DEFAULT-ALARM:TRUE'] as $kept) {
            $this->assertStringContainsString($kept, $out);
        }
    }

    /** RT-6 (fixed by #1397): a DTEND in another zone keeps its zone, and the duration is exact. */
    public function test_rt6_end_time_zone_is_read_and_survives_a_time_edit(): void
    {
        $ics = $this->calendar("UID:u1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Flight\r\n"
            ."DTSTART;TZID=Europe/Amsterdam:20260601T100000\r\n"
            ."DTEND;TZID=America/New_York:20260601T130000\r\n");

        // 10:00 Amsterdam (08:00Z) to 13:00 New York (17:00Z) is nine hours.
        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('PT9H', $event['duration']);
        $this->assertSame(
            ['@type' => 'Location', 'relativeTo' => 'end', 'timeZone' => 'America/New_York'],
            $event['locations'][CalendarConversionSupport::END_TIME_ZONE_LOCATION],
        );

        $this->assertStringContainsString("DTEND;TZID=America/New_York:20260601T130000\r\n", $this->patchTitle($ics));
        $this->assertStringContainsString(
            "DTEND;TZID=America/New_York:20260601T140000\r\n",
            $this->patch($ics, ['start' => '2026-06-01T11:00:00', 'end' => '2026-06-01T14:00:00']),
        );
    }

    /**
     * RT-7: the read side still drops RDATE next to overrides. A title edit keeps
     * the stored RDATE (#1392); RT-7 still needs its own read fix.
     */
    public function test_rt7_rdate_missing_on_read_but_survives_a_title_edit(): void
    {
        $ics = $this->calendar(self::BASE."RRULE:FREQ=WEEKLY;COUNT=4\r\nRDATE:20260620T100000Z\r\n",
            "BEGIN:VEVENT\r\nUID:u1\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID:20260622T100000Z\r\n"
            ."SUMMARY:Moved\r\nDTSTART:20260622T120000Z\r\nDTEND:20260622T130000Z\r\nEND:VEVENT\r\n");

        $this->assertArrayNotHasKey('2026-06-20T10:00:00Z', $this->converter->eventFromIcs($ics)['recurrenceOverrides']);
        $this->assertStringContainsString("RDATE:20260620T100000Z\r\n", $this->patchTitle($ics));
    }

    /** RT-8 (fixed by #1392): an override keeps its own alarm, categories and X-props. */
    public function test_rt8_override_extras_survive_a_title_edit(): void
    {
        $alarm = static fn (string $trigger): string => "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:{$trigger}\r\nDESCRIPTION:r\r\nEND:VALARM\r\n";
        $ics = $this->calendar(self::BASE."RRULE:FREQ=WEEKLY;COUNT=4\r\n".$alarm('-PT15M'),
            "BEGIN:VEVENT\r\nUID:u1\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID:20260622T100000Z\r\n"
            ."SUMMARY:Moved\r\nDTSTART:20260622T120000Z\r\nDTEND:20260622T130000Z\r\n"
            ."X-OVERRIDE-NOTE:keep\r\nCATEGORIES:Special\r\n".$alarm('-PT5M')."END:VEVENT\r\n");

        $out = $this->patchTitle($ics);

        $this->assertStringContainsString('X-OVERRIDE-NOTE:keep', $out);
        $this->assertStringContainsString('CATEGORIES:Special', $out);
        $this->assertSame(1, substr_count($out, 'TRIGGER:-PT5M'));
        $this->assertSame(1, substr_count($out, 'TRIGGER:-PT15M'));
    }

    /** RT-9 (fixed by #1392): calendar-level properties are kept. */
    public function test_rt9_vcalendar_level_properties_survive_a_title_edit(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN\r\n"
            ."CALSCALE:GREGORIAN\r\nX-WR-TIMEZONE:Europe/Amsterdam\r\n"
            ."BEGIN:VEVENT\r\n".self::BASE."END:VEVENT\r\nEND:VCALENDAR\r\n";

        $out = $this->patchTitle($ics);

        $this->assertStringContainsString("X-WR-TIMEZONE:Europe/Amsterdam\r\n", $out);
        $this->assertStringContainsString("CALSCALE:GREGORIAN\r\n", $out);
        $this->assertStringContainsString('PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN', $out);
    }

    /** RT-10 (fixed by #1401): sending a map without an entry removes that entry. */
    public function test_rt10_removing_an_alert_or_participant_from_the_map_sticks(): void
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

        $this->assertStringNotContainsString('TRIGGER:-PT1H', $out);
        $this->assertStringContainsString('TRIGGER:-PT15M', $out);
        $this->assertStringNotContainsString('mailto:b@ex.com', $out);
        $this->assertStringContainsString('mailto:a@ex.com', $out);
    }

    /** RT-10 (fixed by #1401): RFC 8620 PatchObject pointer paths are applied. */
    public function test_rt10_patch_object_pointer_paths_are_applied(): void
    {
        $ics = $this->calendar(self::BASE
            ."BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:r\r\nEND:VALARM\r\n"
            ."BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1H\r\nDESCRIPTION:r\r\nEND:VALARM\r\n");

        $out = $this->patch($ics, ['alerts/alert2' => null]);
        $this->assertStringNotContainsString('TRIGGER:-PT1H', $out);
        $this->assertStringContainsString('TRIGGER:-PT15M', $out);
    }

    /** RT-10 (fixed by #1401): the web app's full `locations` map replaces the old location. */
    public function test_rt10_location_edit_replaces_the_old_location(): void
    {
        $ics = $this->calendar(self::BASE."LOCATION:Old room\r\n");

        $out = $this->patch($ics, ['locations' => ['primary' => ['@type' => 'Location', 'name' => 'New room']]]);

        $this->assertStringContainsString("LOCATION:New room\r\n", $out);
        $this->assertStringNotContainsString('Old room', $out);
    }

    /** RT-10 (fixed by #1401): a pointer into a missing object is an invalidPatch error. */
    public function test_rt10_pointer_into_missing_object_is_invalid_patch(): void
    {
        try {
            $this->patch($this->calendar(self::BASE), ['participants/nobody/name' => 'X']);
            $this->fail('Expected invalidPatch');
        } catch (ApiHttpException $e) {
            $this->assertSame('invalidPatch', $e->errorCode());
        }
    }

    /** #1397 + #1401: editing the location keeps a cross-zone event's end zone. */
    public function test_location_edit_keeps_the_end_time_zone(): void
    {
        $ics = $this->calendar("UID:u1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Flight\r\n"
            ."DTSTART;TZID=Europe/Amsterdam:20260601T100000\r\n"
            ."DTEND;TZID=America/New_York:20260601T130000\r\nLOCATION:Schiphol\r\n");

        $out = $this->patch($ics, [
            'locations' => ['primary' => ['@type' => 'Location', 'name' => 'Gate D7']],
            'start' => '2026-06-01T10:30:00',
            'end' => '2026-06-01T13:30:00',
        ]);

        $this->assertStringContainsString("LOCATION:Gate D7\r\n", $out);
        $this->assertStringContainsString("DTEND;TZID=America/New_York:20260601T133000\r\n", $out);
    }

    /** RT-11 (fixed by #1402): COLOR is read into color and written back. */
    public function test_rt11_color_is_mapped(): void
    {
        $ics = $this->calendar(self::BASE."COLOR:turquoise\r\n");
        $event = $this->converter->eventFromIcs($ics);

        $this->assertSame('turquoise', $event['color']);
        $this->assertArrayNotHasKey('COLOR', $event['icsProps'] ?? []);

        $this->assertStringContainsString("COLOR:turquoise\r\n", $this->patchTitle($ics));
        $this->assertStringContainsString("COLOR:red\r\n", $this->patch($ics, ['color' => 'red']));
        $this->assertStringNotContainsString('COLOR', $this->patch($ics, ['color' => null]));
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
     * Mirrors JMAP CalendarEvent/set (persistEventMutation with a PatchObject) for a single-VEVENT object,
     * including the in-place patch (#1392).
     *
     * @param  array<string, mixed>  $patch
     */
    private function patch(string $ics, array $patch): string
    {
        $existing = $this->converter->eventFromIcs($ics);
        $merged = CalendarConversionSupport::normalizeEventMapKeys(
            CalendarConversionSupport::applyEventPatchObject($existing, $patch),
            $existing,
        );
        $baseline = CalendarConversionSupport::normalizeEventMapKeys($existing, $existing);

        return ICalendarInPlacePatcher::patch(
            $ics,
            $this->converter->icsFromEvent($baseline),
            $this->converter->icsFromEvent($merged),
        );
    }

    private function unfold(string $ics): string
    {
        return str_replace("\r\n ", '', $ics);
    }
}
