<?php

declare(strict_types=1);

namespace Tests\Unit\Tasks;

use App\Services\Tasks\Conversion\ConversionSupport;
use App\Services\Tasks\Conversion\IcsJmapTaskConverter;
use PHPUnit\Framework\TestCase;

/**
 * Characterization tests for round-trip data loss on Task edits.
 *
 * Each test replays TaskRepository::patch for a single-VTODO object: read the
 * stored ICS, deep-merge the patch, rebuild the ICS. Inputs are what
 * Thunderbird, Apple Reminders and DAVx5 task apps (jtx Board, Tasks.org) write.
 *
 * These tests pin CURRENT (lossy) behavior so the gaps in
 * docs/architecture/jscalendar-conformance.md stay provable. The fix for a
 * finding (RT-Tn) flips the matching assertions.
 */
final class TaskRoundTripLossTest extends TestCase
{
    private IcsJmapTaskConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new IcsJmapTaskConverter;
    }

    /** RT-T1: several RELATED-TO collapse into one, RELTYPE is dropped — subtask links break. */
    public function test_rt_t1_related_to_links_collapse_and_lose_reltype(): void
    {
        $out = $this->patchTitle($this->todo(
            "RELATED-TO;RELTYPE=CHILD:c1\r\nRELATED-TO;RELTYPE=CHILD:c2\r\nRELATED-TO;RELTYPE=PARENT:p0\r\n"
        ));

        $this->assertSame(1, substr_count($out, 'RELATED-TO'));
        $this->assertStringNotContainsString('RELTYPE', $out);
        $this->assertStringNotContainsString(':c1', $out);
        $this->assertStringNotContainsString(':c2', $out);
    }

    /** RT-T2: SEQUENCE is treated as known but never read or written. */
    public function test_rt_t2_sequence_is_dropped(): void
    {
        $this->assertStringNotContainsString('SEQUENCE', $this->patchTitle($this->todo("SEQUENCE:3\r\n")));
    }

    /** RT-T3: an all-day RECURRENCE-ID is written without VALUE=DATE. */
    public function test_rt_t3_all_day_recurrence_id_loses_value_date(): void
    {
        $out = $this->patchTitle($this->todo(
            "RRULE:FREQ=MONTHLY;COUNT=3\r\n",
            "BEGIN:VTODO\r\nUID:t1\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID;VALUE=DATE:20260720\r\n"
            ."SUMMARY:Parent\r\nDUE;VALUE=DATE:20260721\r\nEND:VTODO\r\n",
        ));

        $this->assertStringContainsString("RECURRENCE-ID:20260720\r\n", $out);
    }

    /** RT-T4: an override VTODO loses its own X-props and inherits master-only properties. */
    public function test_rt_t4_override_loses_own_props_and_inherits_master_rdate(): void
    {
        $out = $this->patchTitle($this->todo(
            "RRULE:FREQ=MONTHLY;COUNT=3\r\nRDATE;VALUE=DATE:20260901\r\n",
            "BEGIN:VTODO\r\nUID:t1\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID;VALUE=DATE:20260720\r\n"
            ."SUMMARY:Parent\r\nDUE;VALUE=DATE:20260721\r\nX-OVR:1\r\nEND:VTODO\r\n",
        ));

        $this->assertStringNotContainsString('X-OVR', $out);
        $this->assertSame(2, substr_count($out, 'RDATE'));
    }

    /** RT-T5: ATTENDEE/ORGANIZER parameters other than CN/PARTSTAT are dropped; CN falls back to the address. */
    public function test_rt_t5_participant_parameters_are_dropped(): void
    {
        $out = $this->patchTitle($this->todo(
            "ORGANIZER;SCHEDULE-AGENT=CLIENT:mailto:org@ex.com\r\n"
            ."ATTENDEE;CN=Bob;ROLE=OPT-PARTICIPANT;RSVP=TRUE;CUTYPE=GROUP;PARTSTAT=NEEDS-ACTION:mailto:bob@ex.com\r\n"
        ));

        foreach (['SCHEDULE-AGENT', 'ROLE=OPT-PARTICIPANT', 'RSVP', 'CUTYPE'] as $lost) {
            $this->assertStringNotContainsString($lost, $out, $lost.' is expected to be lost today');
        }
        $this->assertStringContainsString('ORGANIZER;CN=org@ex.com:mailto:org@ex.com', $out);
    }

    /** RT-T6: VALARM DESCRIPTION and UID are dropped; DISPLAY is written without the required DESCRIPTION. */
    public function test_rt_t6_display_alarm_loses_description_and_uid(): void
    {
        $out = $this->patchTitle($this->todo(
            "BEGIN:VALARM\r\nUID:al1\r\nACTION:DISPLAY\r\nTRIGGER;RELATED=END:-PT1H\r\nDESCRIPTION:Due soon\r\nEND:VALARM\r\n"
        ));

        $this->assertStringContainsString('ACTION:DISPLAY', $out);
        $this->assertStringNotContainsString('DESCRIPTION', $out);
        $this->assertStringNotContainsString('UID:al1', $out);
    }

    /** RT-T7: the tasks wire shape keeps the pre-RFC 8984 names for progress. */
    public function test_rt_t7_progress_uses_pre_rfc_wire_names(): void
    {
        $task = $this->converter->tasksFromIcs($this->todo("STATUS:IN-PROCESS\r\nPERCENT-COMPLETE:40\r\n"))[0];

        $this->assertSame('in-process', $task['workflowStatus']);
        $this->assertSame(40, $task['progress']);
        $this->assertArrayNotHasKey('percentComplete', $task);
    }

    private function todo(string $masterBody, string $extraComponents = ''): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//jtx//EN\r\n"
            ."BEGIN:VTODO\r\nUID:t1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Parent\r\nDUE;VALUE=DATE:20260620\r\n"
            .$masterBody."END:VTODO\r\n".$extraComponents."END:VCALENDAR\r\n";
    }

    /** Mirrors TaskRepository::patch for a single-VTODO object. */
    private function patchTitle(string $ics): string
    {
        $existing = $this->converter->tasksFromIcs($ics, 't1.ics', 'inbox')[0];

        return $this->converter->icsFromTask(ConversionSupport::deepMergeTaskPatch($existing, ['title' => 'Renamed']));
    }
}
