<?php

declare(strict_types=1);

namespace Tests\Unit\Notes;

use App\Models\CalendarObject;
use App\Services\Notes\Conversion\NoteJournalConverter;
use PHPUnit\Framework\TestCase;

final class NoteJournalConverterTest extends TestCase
{
    public function test_from_ics_prefers_last_modified_over_dtstamp(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VJOURNAL\r\nUID:n-1\r\nDTSTAMP:20260101T000000Z\r\nLAST-MODIFIED:20260810T120000Z\r\nSUMMARY:Hello\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n";
        $note = (new NoteJournalConverter)->fromIcs($ics, 'n-1');

        $this->assertSame('2026-08-10T12:00:00Z', $note['updatedAt']);
    }

    public function test_from_ics_falls_back_to_dtstamp(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VJOURNAL\r\nUID:n-2\r\nDTSTAMP:20260828T120000Z\r\nSUMMARY:Hello\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n";
        $note = (new NoteJournalConverter)->fromIcs($ics, 'n-2');

        $this->assertSame('2026-08-28T12:00:00Z', $note['updatedAt']);
    }

    public function test_from_object_uses_row_lastmodified_when_ics_has_no_stamp(): void
    {
        $object = new CalendarObject;
        $object->uid = 'n-3';
        $object->etag = 'abc';
        $object->lastmodified = 1_755_734_400;
        $object->calendardata = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VJOURNAL\r\nUID:n-3\r\nSUMMARY:Hello\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n";

        $note = (new NoteJournalConverter)->fromObject($object, 'notes-general');

        $this->assertSame(gmdate('Y-m-d\TH:i:s\Z', 1_755_734_400), $note['updatedAt']);
    }

    public function test_empty_summary_and_description_round_trip(): void
    {
        $converter = new NoteJournalConverter;
        $ics = $converter->toIcs([
            'id' => 'n-empty',
            'title' => null,
            'body' => '',
        ]);

        $this->assertStringContainsString('BEGIN:VJOURNAL', $ics);
        $this->assertStringNotContainsString('SUMMARY', $ics);
        $this->assertStringNotContainsString('DESCRIPTION', $ics);

        $note = $converter->fromIcs($ics, 'n-empty');
        $this->assertSame('n-empty', $note['id']);
        $this->assertNull($note['title']);
        $this->assertSame('', $note['body']);

        $blanked = $converter->toIcs([
            'id' => 'n-blank',
            'title' => '',
            'body' => '',
        ]);
        $this->assertStringContainsString('SUMMARY', $blanked);
        $this->assertSame('', $converter->fromIcs($blanked, 'n-blank')['title']);

        $patched = $converter->mergeIntoIcs($ics, ['title' => 'Only title', 'body' => '']);
        $merged = $converter->fromIcs($patched, 'n-empty');
        $this->assertSame('Only title', $merged['title']);
        $this->assertSame('', $merged['body']);
    }
}
