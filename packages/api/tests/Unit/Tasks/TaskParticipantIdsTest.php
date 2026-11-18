<?php

declare(strict_types=1);

namespace Tests\Unit\Tasks;

use App\Services\Tasks\Conversion\IcsJmapTaskConverter;
use PHPUnit\Framework\TestCase;

/**
 * Stable participant ids (#2172): `org`, `u:<username>`, `e:<lowercased email>`.
 */
final class TaskParticipantIdsTest extends TestCase
{
    public function test_ids_are_stable_per_person(): void
    {
        $participants = $this->participants(
            "ORGANIZER;CN=Org:mailto:org@ex.com\r\n"
            ."ATTENDEE;CN=Guest:mailto:Guest@Ex.com\r\n"
            ."ATTENDEE;CN=Carol;X-WGW-USERNAME=Carol:mailto:carol@ex.com\r\n"
        );

        $this->assertSame(['org', 'e:guest@ex.com', 'u:carol'], array_keys($participants));
        $this->assertSame('carol', $participants['u:carol']['username']);
        $this->assertNull($participants['e:guest@ex.com']['username']);
        $this->assertSame('Guest@Ex.com', $participants['e:guest@ex.com']['email']);
        $this->assertSame(['owner'], $participants['org']['roles']);
    }

    public function test_removing_one_attendee_does_not_shift_the_other_ids(): void
    {
        $first = $this->participants("ATTENDEE:mailto:a@ex.com\r\nATTENDEE:mailto:b@ex.com\r\n");
        $second = $this->participants("ATTENDEE:mailto:b@ex.com\r\n");

        $this->assertSame($first['e:b@ex.com'], $second['e:b@ex.com']);
    }

    public function test_the_same_person_twice_reads_as_one_entry_from_the_first_line(): void
    {
        $participants = $this->participants(
            "ATTENDEE;CN=First;PARTSTAT=ACCEPTED:mailto:Bob@ex.com\r\n"
            ."ATTENDEE;CN=Second:mailto:bob@ex.com\r\n"
        );

        $this->assertSame(['e:bob@ex.com'], array_keys($participants));
        $this->assertSame('First', $participants['e:bob@ex.com']['name']);
        $this->assertSame('accepted', $participants['e:bob@ex.com']['participationStatus']);
    }

    public function test_override_does_not_copy_the_master_assignees(): void
    {
        $converter = new IcsJmapTaskConverter;
        $task = $converter->tasksFromIcs(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\n"
            ."BEGIN:VTODO\r\nUID:t1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Weekly\r\nDUE;VALUE=DATE:20260601\r\n"
            ."RRULE:FREQ=WEEKLY;COUNT=3\r\nATTENDEE;X-WGW-USERNAME=carol:mailto:carol@ex.com\r\nEND:VTODO\r\n"
            ."BEGIN:VTODO\r\nUID:t1\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID;VALUE=DATE:20260608\r\nSUMMARY:Moved\r\n"
            ."DUE;VALUE=DATE:20260609\r\nEND:VTODO\r\nEND:VCALENDAR\r\n",
            't1.ics',
            'inbox',
        )[0];

        $out = $converter->icsFromTask($task);

        $this->assertSame(1, substr_count($out, 'ATTENDEE'));
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function participants(string $lines): array
    {
        $task = (new IcsJmapTaskConverter)->tasksFromIcs(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\nBEGIN:VTODO\r\nUID:t1\r\nDTSTAMP:20260101T000000Z\r\n"
            ."SUMMARY:T\r\n".$lines."END:VTODO\r\nEND:VCALENDAR\r\n",
            't1.ics',
            'inbox',
        )[0];

        return $task['participants'];
    }
}
