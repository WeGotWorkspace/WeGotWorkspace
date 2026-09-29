<?php

declare(strict_types=1);

namespace Tests\Unit\Tasks;

use App\Services\Tasks\Conversion\JmapToIcsTaskConverter;
use PHPUnit\Framework\TestCase;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Reader;

final class JmapToIcsTaskConverterRemoveTest extends TestCase
{
    private JmapToIcsTaskConverter $converter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->converter = new JmapToIcsTaskConverter;
    }

    public function test_removing_the_only_vtodo_drops_a_timezone_only_calendar(): void
    {
        $ics = <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WeGotWorkspace//Tasks API//EN
BEGIN:VTIMEZONE
TZID:Europe/Vienna
BEGIN:STANDARD
DTSTART:19701025T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
END:VTIMEZONE
BEGIN:VTODO
UID:only-task
SUMMARY:Only
DUE;TZID=Europe/Vienna:20260912T150000
END:VTODO
END:VCALENDAR
ICS;

        $result = $this->converter->removeTaskFromIcs($ics, 'only-task');

        $this->assertNull($result);
    }

    public function test_removing_one_of_two_vtodos_keeps_only_the_other(): void
    {
        $ics = <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WeGotWorkspace//Tasks API//EN
BEGIN:VTODO
UID:keep-me
SUMMARY:Keep
DUE:20260912T150000Z
END:VTODO
BEGIN:VTODO
UID:drop-me
SUMMARY:Drop
DUE:20260913T150000Z
END:VTODO
END:VCALENDAR
ICS;

        $result = $this->converter->removeTaskFromIcs($ics, 'drop-me');

        $this->assertIsString($result);
        $calendar = Reader::read($result);
        $this->assertInstanceOf(VCalendar::class, $calendar);
        $todos = $calendar->select('VTODO');
        $this->assertCount(1, $todos);
        $this->assertSame('keep-me', (string) $todos[0]->UID);
        $this->assertStringNotContainsString('drop-me', $result);
    }
}
