<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use PHPUnit\Framework\TestCase;

final class ICalendarJmapEventConverterTest extends TestCase
{
    private ICalendarJmapEventConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new ICalendarJmapEventConverter;
    }

    public function test_round_trip_simple_event(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-uid-1\r\nSUMMARY:Simple Event\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nDESCRIPTION:Notes here\r\nLOCATION:Room A\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('Event', $event['@type']);
        $this->assertSame('test-uid-1', $event['uid']);
        $this->assertSame('Simple Event', $event['title']);
        $this->assertSame('2026-06-15T10:00:00Z', $event['start']);
        $this->assertSame('2026-06-15T11:00:00Z', $event['end']);
        $this->assertSame('PT1H', $event['duration']);
        $this->assertSame('Notes here', $event['description']);
        $this->assertSame('Room A', $event['locations']['loc1']['name']);

        $roundTrip = $this->converter->icsFromEvent(array_merge($event, [
            'calendarIds' => ['default' => true],
        ]));
        $this->assertStringContainsString('SUMMARY:Simple Event', $roundTrip);
        $this->assertStringContainsString('UID:test-uid-1', $roundTrip);
        $this->assertStringContainsString('LOCATION:Room A', $roundTrip);
    }

    public function test_floating_dtend_emits_duration_for_apple_style_ics(): void
    {
        // Apple Calendar writes DTSTART/DTEND without DURATION; web client needs duration.
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//macOS 26.0.1//EN\r\n"
            ."BEGIN:VEVENT\r\nUID:urn:uuid:synct-ie\r\nSUMMARY:Synct ie\r\n"
            ."DTSTART:20260810T100000\r\nDTEND:20260810T140000\r\n"
            ."RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('2026-08-10T10:00:00', $event['start']);
        $this->assertSame('2026-08-10T14:00:00', $event['end']);
        $this->assertSame('PT4H', $event['duration']);
    }

    public function test_recurring_event_preserves_rrule(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:recur\r\nSUMMARY:Daily\r\nDTSTART:20260601T080000Z\r\nDTEND:20260601T083000Z\r\nRRULE:FREQ=DAILY;INTERVAL=2;COUNT=5\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertCount(1, $event['recurrenceRules']);
        $this->assertSame('daily', $event['recurrenceRules'][0]['frequency']);
        $this->assertSame(2, $event['recurrenceRules'][0]['interval']);
        $this->assertSame(5, $event['recurrenceRules'][0]['count']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5', $roundTrip);
    }

    public function test_all_day_event_sets_show_without_time(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:allday\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20260704\r\nDTEND;VALUE=DATE:20260705\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertTrue($event['showWithoutTime']);
        $this->assertSame('2026-07-04', $event['start']);
        $this->assertSame('P1D', $event['duration']);
    }

    public function test_multi_vevent_reads_all_events(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:First\r\nDTSTART:20260601T080000Z\r\nDTEND:20260601T090000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Second\r\nDTSTART:20260602T080000Z\r\nDTEND:20260602T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $events = $this->converter->eventsFromIcs($ics);
        $this->assertCount(2, $events);
        $this->assertSame('First', $events[0]['title']);
        $this->assertSame('Second', $events[1]['title']);
    }

    public function test_write_emits_single_vevent(): void
    {
        $ics = $this->converter->icsFromEvent([
            '@type' => 'Event',
            'uid' => 'write-1',
            'calendarIds' => ['default' => true],
            'title' => 'Written',
            'start' => '2026-06-15T10:00:00Z',
            'end' => '2026-06-15T11:00:00Z',
        ]);

        $this->assertSame(1, substr_count($ics, 'BEGIN:VEVENT'));
        $this->assertSame(1, substr_count($ics, 'END:VEVENT'));
    }

    public function test_relative_valarm_reads_as_jmap_alert(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:alarm-1\r\nSUMMARY:Meeting\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertArrayHasKey('alerts', $event);
        $this->assertSame('display', $event['alerts']['alert1']['action']);
        $this->assertSame('RelativeAlert', $event['alerts']['alert1']['trigger']['@type']);
        $this->assertSame('-PT15M', $event['alerts']['alert1']['trigger']['offset']);
    }

    public function test_absolute_valarm_reads_as_jmap_alert(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:alarm-2\r\nSUMMARY:Meeting\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:20260615T094500Z\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('AbsoluteAlert', $event['alerts']['alert1']['trigger']['@type']);
        $this->assertSame('2026-06-15T09:45:00Z', $event['alerts']['alert1']['trigger']['when']);
    }

    public function test_valarm_action_types_map_to_jmap(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:alarm-3\r\nSUMMARY:Meeting\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nBEGIN:VALARM\r\nACTION:AUDIO\r\nTRIGGER;RELATED=END:-PT5M\r\nEND:VALARM\r\nBEGIN:VALARM\r\nACTION:EMAIL\r\nTRIGGER:-PT1H\r\nSUMMARY:Email reminder\r\nATTENDEE:mailto:bob@example.com\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('audio', $event['alerts']['alert1']['action']);
        $this->assertSame('end', $event['alerts']['alert1']['trigger']['relatedTo']);
        $this->assertSame('email', $event['alerts']['alert2']['action']);
    }

    public function test_participant_scheduling_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:sched-1\r\nSUMMARY:Meeting\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nORGANIZER;CN=Alice:mailto:alice@example.com\r\nATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE;CN=Bob:mailto:bob@example.com\r\nATTENDEE;CUTYPE=RESOURCE;ROLE=OPT-PARTICIPANT;PARTSTAT=DECLINED;DELEGATED-TO=\"mailto:carol@example.com\";CN=Room A:mailto:room@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame(['owner'], $event['participants']['org']['roles']);
        $this->assertSame('individual', $event['participants']['att1']['kind']);
        $this->assertTrue($event['participants']['att1']['expectReply']);
        $this->assertSame('resource', $event['participants']['att2']['kind']);
        $this->assertSame('optional', $event['participants']['att2']['roles'][0]);
        $this->assertSame('carol@example.com', $event['participants']['att2']['delegatedTo']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $defolded = str_replace("\r\n ", '', $roundTrip);
        $this->assertStringContainsString('ROLE=REQ-PARTICIPANT', $defolded);
        $this->assertStringContainsString('CUTYPE=INDIVIDUAL', $defolded);
        $this->assertStringContainsString('RSVP=TRUE', $defolded);
        $this->assertStringContainsString('mailto:carol@example.com', $defolded);
    }

    public function test_geo_url_and_virtual_location_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:loc-1\r\nSUMMARY:Online\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nLOCATION:Zoom Room\r\nGEO:37.386013;-122.082932\r\nURL:https://meet.example.com/room\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('Zoom Room', $event['locations']['loc1']['name']);
        $this->assertSame('geo:37.386013;-122.082932', $event['locations']['loc1']['coordinates']);
        $this->assertSame('https://meet.example.com/room', $event['links']['link1']['href']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('GEO:37.386013;-122.082932', $roundTrip);
        $this->assertStringContainsString('https://meet.example.com/room', $roundTrip);
    }

    public function test_rdate_and_exrule_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:rdate-1\r\nSUMMARY:Series\r\nDTSTART:20260601T080000Z\r\nDTEND:20260601T083000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nRDATE:20260615T080000Z\r\nEXRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1\r\nEXDATE:20260608T080000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertArrayHasKey('2026-06-15T08:00:00Z', $event['recurrenceOverrides']);
        $this->assertSame([], $event['recurrenceOverrides']['2026-06-15T08:00:00Z']);
        $this->assertCount(1, $event['excludedRecurrenceRules']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('RDATE:20260615T080000Z', $roundTrip);
        $this->assertStringContainsString('EXRULE:', $roundTrip);
    }

    public function test_tentative_status_maps_to_free_busy_status(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:tent-1\r\nSUMMARY:Tentative\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nSTATUS:TENTATIVE\r\nTRANSP:OPAQUE\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('tentative', $event['status']);
        $this->assertSame('tentative', $event['freeBusyStatus']);
    }

    public function test_rrule_by_set_position_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:bypos\r\nSUMMARY:Last Friday\r\nDTSTART:20260601T080000Z\r\nDTEND:20260601T083000Z\r\nRRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('monthly', $event['recurrenceRules'][0]['frequency']);
        $this->assertSame([['@type' => 'NDay', 'day' => 'fr']], $event['recurrenceRules'][0]['byDay']);
        $this->assertSame([-1], $event['recurrenceRules'][0]['bySetPosition']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1', $roundTrip);
    }

    /**
     * Regression: Sabre's Recur property returns multi-value rule parts as arrays,
     * which the reader used to cast to the literal string "Array", corrupting
     * byDay/bySetPosition (and all other BY* lists) on read.
     */
    public function test_rrule_multi_value_by_parts_read_and_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:multi-by\r\nSUMMARY:Complex series\r\nDTSTART:20260601T080000Z\r\nDTEND:20260601T083000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=2MO,TU,-1SU;BYSETPOS=1,2;BYMONTH=1,6\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $rule = $event['recurrenceRules'][0];
        $this->assertSame([
            ['@type' => 'NDay', 'day' => 'mo', 'nthOfPeriod' => 2],
            ['@type' => 'NDay', 'day' => 'tu'],
            ['@type' => 'NDay', 'day' => 'su', 'nthOfPeriod' => -1],
        ], $rule['byDay']);
        $this->assertSame([1, 2], $rule['bySetPosition']);
        $this->assertSame(['1', '6'], $rule['byMonth']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $defolded = str_replace("\r\n ", '', $roundTrip);
        $this->assertStringContainsString('BYDAY=2MO,TU,-1SU', $defolded);
        $this->assertStringContainsString('BYSETPOS=1,2', $defolded);
        $this->assertStringContainsString('BYMONTH=1,6', $defolded);
    }

    /**
     * RFC 8984 §4.3.3: byMonth is String[] on the wire (month numbers as strings),
     * not Int[]. BYMONTH=3 must read as ["3"] and round-trip back to BYMONTH=3.
     */
    public function test_rrule_by_month_string_wire_type_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:bymonth-str\r\nSUMMARY:Yearly\r\nDTSTART:20260301T080000Z\r\nDTEND:20260301T083000Z\r\nRRULE:FREQ=YEARLY;BYMONTH=3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame(['3'], $event['recurrenceRules'][0]['byMonth']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('BYMONTH=3', $roundTrip);

        $reRead = $this->converter->eventFromIcs($roundTrip);
        $this->assertSame(['3'], $reRead['recurrenceRules'][0]['byMonth']);
    }

    /**
     * RFC 8984 §4.3.3: the leap-month suffix "L" (RFC 7529 RSCALE calendars) rides
     * along in the byMonth string values, e.g. BYMONTH=3L → ["3L"].
     */
    public function test_rrule_by_month_leap_month_suffix_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:bymonth-leap\r\nSUMMARY:Leap month\r\nDTSTART:20260301T080000Z\r\nDTEND:20260301T083000Z\r\nRRULE:RSCALE=CHINESE;FREQ=YEARLY;BYMONTH=3L\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame(['3L'], $event['recurrenceRules'][0]['byMonth']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('BYMONTH=3L', $roundTrip);

        $reRead = $this->converter->eventFromIcs($roundTrip);
        $this->assertSame(['3L'], $reRead['recurrenceRules'][0]['byMonth']);
    }

    /**
     * RFC 8984 §4.3.3: byDay entries are NDay objects, not iCal weekday strings.
     */
    public function test_rrule_by_day_nday_objects_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:byday-nday\r\nSUMMARY:Second Monday\r\nDTSTART:20260601T080000Z\r\nDTEND:20260601T083000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=+2MO,-1SU\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame([
            ['@type' => 'NDay', 'day' => 'mo', 'nthOfPeriod' => 2],
            ['@type' => 'NDay', 'day' => 'su', 'nthOfPeriod' => -1],
        ], $event['recurrenceRules'][0]['byDay']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('BYDAY=2MO,-1SU', $roundTrip);

        $reRead = $this->converter->eventFromIcs($roundTrip);
        $this->assertSame($event['recurrenceRules'], $reRead['recurrenceRules']);
    }

    /**
     * RFC 8984 §4.3.3: byHour/byMinute/bySecond are UnsignedInt[]; BYHOUR/BYMINUTE/
     * BYSECOND used to be dropped on read entirely.
     */
    public function test_rrule_by_hour_minute_second_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:bytime\r\nSUMMARY:Twice a day\r\nDTSTART:20260601T080000Z\r\nDTEND:20260601T083000Z\r\nRRULE:FREQ=DAILY;BYHOUR=9,17;BYMINUTE=30;BYSECOND=0\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $rule = $event['recurrenceRules'][0];
        $this->assertSame([9, 17], $rule['byHour']);
        $this->assertSame([30], $rule['byMinute']);
        $this->assertSame([0], $rule['bySecond']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $defolded = str_replace("\r\n ", '', $roundTrip);
        $this->assertStringContainsString('BYHOUR=9,17', $defolded);
        $this->assertStringContainsString('BYMINUTE=30', $defolded);
        $this->assertStringContainsString('BYSECOND=0', $defolded);
    }

    /**
     * Defensive tolerance on write: legacy wire shapes (byDay iCal strings, byMonth
     * integers) — still produced by the tasks domain and possibly by old clients —
     * must serialize to the same valid RRULE as the RFC 8984 shapes.
     */
    public function test_rrule_write_tolerates_legacy_by_day_strings_and_by_month_integers(): void
    {
        $ics = $this->converter->icsFromEvent([
            '@type' => 'Event',
            'uid' => 'legacy-shapes',
            'calendarIds' => ['default' => true],
            'title' => 'Legacy',
            'start' => '2026-06-01T08:00:00Z',
            'end' => '2026-06-01T08:30:00Z',
            'recurrenceRules' => [
                [
                    '@type' => 'RecurrenceRule',
                    'frequency' => 'monthly',
                    'byDay' => ['+2MO', 'TU'],
                    'byMonth' => [1, 6],
                ],
            ],
        ]);

        $defolded = str_replace("\r\n ", '', $ics);
        $this->assertStringContainsString('BYDAY=+2MO,TU', $defolded);
        $this->assertStringContainsString('BYMONTH=1,6', $defolded);
    }

    public function test_alerts_round_trip_to_valarm(): void
    {
        $event = [
            '@type' => 'Event',
            'uid' => 'alarm-rt',
            'calendarIds' => ['default' => true],
            'title' => 'Meeting',
            'start' => '2026-06-15T10:00:00Z',
            'end' => '2026-06-15T11:00:00Z',
            'alerts' => [
                'a1' => [
                    '@type' => 'Alert',
                    'action' => 'display',
                    'trigger' => [
                        '@type' => 'RelativeAlert',
                        'offset' => '-PT15M',
                    ],
                ],
                'a2' => [
                    '@type' => 'Alert',
                    'action' => 'display',
                    'trigger' => [
                        '@type' => 'AbsoluteAlert',
                        'when' => '2026-06-15T09:45:00Z',
                    ],
                ],
            ],
        ];

        $ics = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('BEGIN:VALARM', $ics);
        $this->assertStringContainsString('TRIGGER:-PT15M', $ics);
        $this->assertStringContainsString('TRIGGER;VALUE=DATE-TIME:20260615T094500Z', $ics);

        $roundTrip = $this->converter->eventFromIcs($ics);
        $this->assertSame('-PT15M', $roundTrip['alerts']['alert1']['trigger']['offset']);
        $this->assertSame('2026-06-15T09:45:00Z', $roundTrip['alerts']['alert2']['trigger']['when']);
    }

    /**
     * Pins the documented lossy behavior from docs/calendars/ics-jmap-conversion-matrix.md
     * ("Non-reversible" note): the JMAP Alert wire shape is limited to @type/action/trigger
     * by the OpenAPI contract (CalendarEventAlert, additionalProperties: false), so VALARM
     * sub-properties cannot ride along. Action and trigger ARE preserved; DISPLAY
     * DESCRIPTION is regenerated as a generic placeholder on write.
     */
    public function test_display_valarm_description_is_lossy_but_action_and_trigger_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:lossy-1\r\nSUMMARY:Meeting\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Custom reminder text\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame(
            ['@type', 'action', 'trigger'],
            array_keys($event['alerts']['alert1']),
            'Alert shape is pinned to @type/action/trigger by the OpenAPI contract'
        );
        $this->assertSame('display', $event['alerts']['alert1']['action']);
        $this->assertSame('-PT15M', $event['alerts']['alert1']['trigger']['offset']);

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('ACTION:DISPLAY', $roundTrip);
        $this->assertStringContainsString('TRIGGER:-PT15M', $roundTrip);
        $this->assertStringContainsString('DESCRIPTION:Reminder', $roundTrip);
        $this->assertStringNotContainsString('Custom reminder text', $roundTrip);
    }

    /**
     * Pins the documented lossy behavior for EMAIL alarms: original ATTENDEE and SUMMARY
     * are dropped on read; write synthesizes SUMMARY from the event title and a
     * placeholder ATTENDEE so the emitted VALARM stays RFC 5545 valid.
     */
    public function test_email_valarm_attendee_and_summary_are_lossy_and_synthesized_on_write(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:lossy-2\r\nSUMMARY:Standup\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nBEGIN:VALARM\r\nACTION:EMAIL\r\nTRIGGER:-PT1H\r\nSUMMARY:Original email subject\r\nATTENDEE:mailto:bob@example.com\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('email', $event['alerts']['alert1']['action']);
        $this->assertSame('-PT1H', $event['alerts']['alert1']['trigger']['offset']);
        $this->assertSame(['@type', 'action', 'trigger'], array_keys($event['alerts']['alert1']));

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('ACTION:EMAIL', $roundTrip);
        $this->assertStringContainsString('TRIGGER:-PT1H', $roundTrip);
        $this->assertStringContainsString('SUMMARY:Standup', $roundTrip);
        $this->assertStringContainsString('ATTENDEE:mailto:organizer@invalid', $roundTrip);
        $this->assertStringNotContainsString('Original email subject', $roundTrip);
        $this->assertStringNotContainsString('bob@example.com', $roundTrip);
    }

    /**
     * Pins the documented lossy behavior for AUDIO alarms: ATTACH (sound resource) is
     * dropped on read and not regenerated; action and trigger survive the round-trip.
     */
    public function test_audio_valarm_attach_is_lossy_but_action_and_trigger_round_trip(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:lossy-3\r\nSUMMARY:Meeting\r\nDTSTART:20260615T100000Z\r\nDTEND:20260615T110000Z\r\nBEGIN:VALARM\r\nACTION:AUDIO\r\nTRIGGER:-PT5M\r\nATTACH;FMTTYPE=audio/basic:https://example.com/ding.aud\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertSame('audio', $event['alerts']['alert1']['action']);
        $this->assertSame('-PT5M', $event['alerts']['alert1']['trigger']['offset']);
        $this->assertSame(['@type', 'action', 'trigger'], array_keys($event['alerts']['alert1']));

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('ACTION:AUDIO', $roundTrip);
        $this->assertStringContainsString('TRIGGER:-PT5M', $roundTrip);
        $this->assertStringNotContainsString('ding.aud', $roundTrip);
    }

    /**
     * Regression test for commit 8de651546 (#143): timeZonesFromCalendar stores a *bare*
     * serialized VTIMEZONE in timeZones[tzid].icsDefinition, and Sabre's Reader requires
     * a VCALENDAR wrapper. Without the wrap in TimeZoneSupport::writeTimeZonesToCalendar,
     * the VTIMEZONE is silently dropped (or the read throws) when writing the event back.
     */
    public function test_bare_vtimezone_ics_definition_is_wrapped_and_round_trips(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Amsterdam\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:tz-wrap-1\r\nSUMMARY:Local meeting\r\nDTSTART;TZID=Europe/Amsterdam:20260615T100000\r\nDTEND;TZID=Europe/Amsterdam:20260615T110000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

        $event = $this->converter->eventFromIcs($ics);
        $this->assertArrayHasKey('timeZones', $event);
        $this->assertArrayHasKey('Europe/Amsterdam', $event['timeZones']);

        $definition = $event['timeZones']['Europe/Amsterdam']['icsDefinition'];
        $this->assertStringStartsWith('BEGIN:VTIMEZONE', $definition);
        $this->assertStringNotContainsString(
            'BEGIN:VCALENDAR',
            $definition,
            'Precondition: stored icsDefinition is a bare VTIMEZONE — exactly the shape the 8de651546 wrap fix exists for'
        );

        $roundTrip = $this->converter->icsFromEvent($event);
        $this->assertStringContainsString('BEGIN:VTIMEZONE', $roundTrip);
        $this->assertStringContainsString('TZID:Europe/Amsterdam', $roundTrip);
        $this->assertStringContainsString('TZOFFSETTO:+0200', $roundTrip);
        $this->assertStringContainsString('DTSTART;TZID=Europe/Amsterdam:20260615T100000', $roundTrip);
    }
}
