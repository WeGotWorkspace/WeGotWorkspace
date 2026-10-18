<?php

declare(strict_types=1);

namespace Tests\Unit\Tasks;

use App\Services\Tasks\Conversion\ConversionSupport;
use App\Services\Tasks\Conversion\IcsJmapTaskConverter;
use App\Services\VObject\ICalendarInPlacePatcher;
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
 * finding (RT-Tn) flips the matching assertions. Tests named `*_survive_*`
 * pin findings that #1392 fixed for unrelated edits.
 */
final class TaskRoundTripLossTest extends TestCase
{
    private IcsJmapTaskConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new IcsJmapTaskConverter;
    }

    /** RT-T1 (fixed by #1392): every RELATED-TO keeps its RELTYPE. */
    public function test_rt_t1_related_to_links_survive_a_title_edit(): void
    {
        $out = $this->patchTitle($this->todo(
            "RELATED-TO;RELTYPE=CHILD:c1\r\nRELATED-TO;RELTYPE=CHILD:c2\r\nRELATED-TO;RELTYPE=PARENT:p0\r\n"
        ));

        $this->assertStringContainsString("RELATED-TO;RELTYPE=CHILD:c1\r\n", $out);
        $this->assertStringContainsString("RELATED-TO;RELTYPE=CHILD:c2\r\n", $out);
        $this->assertStringContainsString("RELATED-TO;RELTYPE=PARENT:p0\r\n", $out);
    }

    /** RT-T2 (kept on unrelated edits by #1392): SEQUENCE survives. Bumping it is RT-T2's own fix. */
    public function test_rt_t2_sequence_survives_a_title_edit(): void
    {
        $this->assertStringContainsString("SEQUENCE:3\r\n", $this->patchTitle($this->todo("SEQUENCE:3\r\n")));
    }

    /** RT-T3 (fixed for unrelated edits by #1392): the stored all-day RECURRENCE-ID keeps VALUE=DATE. */
    public function test_rt_t3_all_day_recurrence_id_survives_a_title_edit(): void
    {
        $out = $this->patchTitle($this->todo(
            "RRULE:FREQ=MONTHLY;COUNT=3\r\n",
            "BEGIN:VTODO\r\nUID:t1\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID;VALUE=DATE:20260720\r\n"
            ."SUMMARY:Parent\r\nDUE;VALUE=DATE:20260721\r\nEND:VTODO\r\n",
        ));

        $this->assertStringContainsString("RECURRENCE-ID;VALUE=DATE:20260720\r\n", $out);
        $this->assertSame(1, substr_count($out, 'RECURRENCE-ID'));
    }

    /** RT-T4 (fixed by #1392): an override keeps its own X-props and gets no master-only properties. */
    public function test_rt_t4_override_survives_a_title_edit(): void
    {
        $out = $this->patchTitle($this->todo(
            "RRULE:FREQ=MONTHLY;COUNT=3\r\nRDATE;VALUE=DATE:20260901\r\n",
            "BEGIN:VTODO\r\nUID:t1\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID;VALUE=DATE:20260720\r\n"
            ."SUMMARY:Parent\r\nDUE;VALUE=DATE:20260721\r\nX-OVR:1\r\nEND:VTODO\r\n",
        ));

        $this->assertStringContainsString("X-OVR:1\r\n", $out);
        $this->assertSame(1, substr_count($out, 'RDATE'));
    }

    /** RT-T5 (fixed for unrelated edits by #1392): participant parameters survive, CN is not invented. */
    public function test_rt_t5_participant_parameters_survive_a_title_edit(): void
    {
        $out = $this->patchTitle($this->todo(
            "ORGANIZER;SCHEDULE-AGENT=CLIENT:mailto:org@ex.com\r\n"
            ."ATTENDEE;CN=Bob;ROLE=OPT-PARTICIPANT;RSVP=TRUE;CUTYPE=GROUP;PARTSTAT=NEEDS-ACTION:mailto:bob@ex.com\r\n"
        ));

        foreach (['SCHEDULE-AGENT=CLIENT', 'ROLE=OPT-PARTICIPANT', 'RSVP=TRUE', 'CUTYPE=GROUP'] as $kept) {
            $this->assertStringContainsString($kept, $out);
        }
        $this->assertStringNotContainsString('CN=org@ex.com', $out);
    }

    /** RT-T6 (fixed for unrelated edits by #1392): a DISPLAY alarm keeps DESCRIPTION and UID. */
    public function test_rt_t6_display_alarm_survives_a_title_edit(): void
    {
        $out = $this->patchTitle($this->todo(
            "BEGIN:VALARM\r\nUID:al1\r\nACTION:DISPLAY\r\nTRIGGER;RELATED=END:-PT1H\r\nDESCRIPTION:Due soon\r\nEND:VALARM\r\n"
        ));

        $this->assertStringContainsString("DESCRIPTION:Due soon\r\n", $out);
        $this->assertStringContainsString("UID:al1\r\n", $out);
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

    /** Mirrors TaskRepository::patch for a single-VTODO object, including the in-place patch (#1392). */
    private function patchTitle(string $ics): string
    {
        $existing = $this->converter->tasksFromIcs($ics, 't1.ics', 'inbox')[0];

        return ICalendarInPlacePatcher::patch(
            $ics,
            $this->converter->icsFromTask($existing),
            $this->converter->icsFromTask(ConversionSupport::deepMergeTaskPatch($existing, ['title' => 'Renamed'])),
        );
    }
}
