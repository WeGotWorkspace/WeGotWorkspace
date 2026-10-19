<?php

declare(strict_types=1);

namespace Tests\Unit\Notes;

use App\Services\Notes\Conversion\NoteJournalConverter;
use PHPUnit\Framework\TestCase;

/**
 * Round-trip behavior of Note edits on VJOURNALs written by other CalDAV apps
 * (jtx Board, Thunderbird). Notes patch the stored VJOURNAL in place, unlike
 * events, tasks and contacts. See docs/architecture/jscalendar-conformance.md.
 *
 * The first test pins what survives; the NT-1 tests pin how several
 * DESCRIPTIONs are handled (#1410).
 */
final class NoteRoundTripTest extends TestCase
{
    public function test_unmodelled_properties_survive_a_title_edit(): void
    {
        $lines = [
            "ATTACH;FMTTYPE=image/png;FILENAME=a.png:https://example.test/a.png\r\n",
            "RELATED-TO;RELTYPE=PARENT:parent-1\r\n",
            "RELATED-TO;RELTYPE=CHILD:child-1\r\n",
            "ATTENDEE;ROLE=REQ-PARTICIPANT;CN=Ann:mailto:ann@example.test\r\n",
            "COLOR:teal\r\n",
            "X-JTX-COLLECTION;X-PARAM=1:work\r\n",
        ];
        $out = (new NoteJournalConverter)->mergeIntoIcs($this->journal(implode('', $lines)), ['title' => 'Renamed']);

        $this->assertStringContainsString("SUMMARY:Renamed\r\n", $out);
        foreach ($lines as $line) {
            $this->assertStringContainsString($line, $out);
        }
        $this->assertStringContainsString("X-WR-CALNAME:Journal\r\n", $out);
    }

    /** NT-1 (fixed by #1410): a body edit updates the first DESCRIPTION and keeps the others and its parameters. */
    public function test_nt1_body_edit_updates_the_first_description_only(): void
    {
        $out = (new NoteJournalConverter)->mergeIntoIcs($this->journal(
            "DESCRIPTION;LANGUAGE=nl:Eerste\r\nDESCRIPTION;LANGUAGE=en:Second\r\n"
        ), ['body' => 'Edited']);

        $this->assertStringContainsString("DESCRIPTION;LANGUAGE=nl:Edited\r\n", $out);
        $this->assertStringContainsString("DESCRIPTION;LANGUAGE=en:Second\r\n", $out);
        $this->assertStringNotContainsString('Eerste', $out);
    }

    /** NT-1 (#1410): clearing the body removes only the first DESCRIPTION. */
    public function test_nt1_clearing_the_body_removes_only_the_first_description(): void
    {
        $out = (new NoteJournalConverter)->mergeIntoIcs($this->journal(
            "DESCRIPTION;LANGUAGE=nl:Eerste\r\nDESCRIPTION;LANGUAGE=en:Second\r\n"
        ), ['body' => '']);

        $this->assertStringNotContainsString('Eerste', $out);
        $this->assertStringContainsString("DESCRIPTION;LANGUAGE=en:Second\r\n", $out);
    }

    private function journal(string $extra): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//techbee//jtx Board//EN\r\nX-WR-CALNAME:Journal\r\n"
            ."BEGIN:VJOURNAL\r\nUID:n-rt\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Original\r\n"
            .$extra
            ."END:VJOURNAL\r\nEND:VCALENDAR\r\n";
    }
}
