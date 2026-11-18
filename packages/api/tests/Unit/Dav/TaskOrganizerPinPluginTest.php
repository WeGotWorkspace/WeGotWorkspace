<?php

declare(strict_types=1);

namespace Tests\Unit\Dav;

use App\Dav\Server\TaskOrganizerPinPlugin;
use PHPUnit\Framework\TestCase;
use Sabre\CalDAV\ICalendarObject;
use Sabre\DAV\INode;

/**
 * A CalDAV PUT cannot change or drop a task's stored ORGANIZER (#2172).
 */
final class TaskOrganizerPinPluginTest extends TestCase
{
    private const STORED_ORGANIZER = 'ORGANIZER;CN=Bob:mailto:bob@example.test';

    public function test_a_put_that_replaces_the_organizer_keeps_the_stored_one(): void
    {
        $data = $this->todo('ORGANIZER;CN=Mallory:mailto:mallory@example.test', 'Renamed');
        $modified = false;

        $this->plugin()->beforeWriteContent('calendars/bob/tasks/a.ics', $this->node($this->todo(self::STORED_ORGANIZER)), $data, $modified);

        $this->assertTrue($modified);
        $this->assertStringContainsString(self::STORED_ORGANIZER, (string) $data);
        $this->assertStringNotContainsString('mallory', (string) $data);
        $this->assertStringContainsString('SUMMARY:Renamed', (string) $data);
    }

    public function test_a_put_that_drops_the_organizer_gets_it_back(): void
    {
        $data = $this->todo('', 'Renamed');
        $modified = false;

        $this->plugin()->beforeWriteContent('calendars/bob/tasks/a.ics', $this->node($this->todo(self::STORED_ORGANIZER)), $data, $modified);

        $this->assertTrue($modified);
        $this->assertStringContainsString(self::STORED_ORGANIZER, (string) $data);
    }

    public function test_an_unchanged_organizer_or_none_stored_leaves_the_body_alone(): void
    {
        $same = $this->todo(self::STORED_ORGANIZER, 'Renamed');
        $modified = false;
        $this->plugin()->beforeWriteContent('calendars/bob/tasks/a.ics', $this->node($this->todo(self::STORED_ORGANIZER)), $same, $modified);
        $this->assertFalse($modified);
        $this->assertSame($this->todo(self::STORED_ORGANIZER, 'Renamed'), $same);

        $new = $this->todo('ORGANIZER;CN=Carol:mailto:carol@example.test', 'Renamed');
        $this->plugin()->beforeWriteContent('calendars/bob/tasks/a.ics', $this->node($this->todo('')), $new, $modified);
        $this->assertFalse($modified);
        $this->assertStringContainsString('carol@example.test', (string) $new);
    }

    private function plugin(): TaskOrganizerPinPlugin
    {
        return new TaskOrganizerPinPlugin;
    }

    private function node(string $stored): INode
    {
        $node = $this->createStub(ICalendarObject::class);
        $node->method('get')->willReturn($stored);

        return $node;
    }

    private function todo(string $organizer, string $summary = 'Buy milk'): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VTODO\r\nUID:pin-1\r\n"
            ."DTSTAMP:20260101T000000Z\r\nSUMMARY:{$summary}\r\n"
            .($organizer !== '' ? $organizer."\r\n" : '')
            ."ATTENDEE;CN=Alice:mailto:alice@example.test\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
    }
}
