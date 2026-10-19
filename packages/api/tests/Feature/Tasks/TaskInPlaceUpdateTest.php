<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarObject;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A WGW task edit patches the stored iCalendar instead of rebuilding it (#1392).
 * Input is a real Apple Reminders capture (macOS 26.6.2, CalDAV list).
 */
final class TaskInPlaceUpdateTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    private const FIXTURE = __DIR__.'/../../fixtures/Interop/RealClients/apple-reminders-macos26-todo.before.ics';

    private const OBJECT_URI = '7D77CEB3-3D5D-47A8-B7B6-D8E66232CAA1.ics';

    private string $taskId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $ics = file_get_contents(self::FIXTURE);
        $this->assertIsString($ics);
        $this->taskId = $this->seedTaskViaPdo('bob', self::OBJECT_URI, $ics);
    }

    public function test_title_edit_keeps_everything_else_reminders_wrote(): void
    {
        $url = '/api/v1/tasks/items/'.rawurlencode($this->taskId);
        $etag = (string) $this->withBearer($this->userBearerToken())->getJson($url)->assertOk()->json('etag');
        $this->withBearer($this->userBearerToken())
            ->withHeader('If-Match', $etag)
            ->patchJson($url, ['title' => 'Renamed in WGW'])
            ->assertOk();

        $stored = (string) CalendarObject::query()->where('uri', self::OBJECT_URI)->firstOrFail()->calendardata;
        $this->assertStringContainsString("SUMMARY:Renamed in WGW\r\n", $stored);
        $this->assertStringContainsString("PRODID:-//Apple Inc.//iOS 26.6.2//EN\r\n", $stored);
        // The alarm keeps its identity and text (RT-T6)
        $this->assertStringContainsString("UID:FA244C6F-4678-4FF4-82AE-11E608EA9EB0\r\n", $stored);
        $this->assertStringContainsString("X-WR-ALARMUID:FA244C6F-4678-4FF4-82AE-11E608EA9EB0\r\n", $stored);
        $this->assertStringContainsString("DESCRIPTION:Reminder\r\n", $stored);
        // The stored open-ended VTIMEZONE is kept (RT-T8)
        $this->assertStringContainsString("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\n", $stored);
        $this->assertStringNotContainsString('TZUNTIL', $stored);
        $this->assertSame(1, substr_count($stored, 'BEGIN:VTIMEZONE'));
    }

    public function test_sequence_is_kept_on_title_edit_and_bumped_on_due_change(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//jtx//EN\r\nBEGIN:VTODO\r\nUID:seq-1\r\nDTSTAMP:20260101T000000Z\r\n"
            ."SUMMARY:Seq\r\nDUE;VALUE=DATE:20260620\r\nSEQUENCE:3\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $taskId = $this->seedTaskViaPdo('bob', 'seq-1.ics', $ics);
        $url = '/api/v1/tasks/items/'.rawurlencode($taskId);

        $this->patchTask($url, ['title' => 'Renamed']);
        $this->assertStringContainsString("SEQUENCE:3\r\n", $this->storedTodo('seq-1.ics'));

        $this->patchTask($url, ['due' => '2026-06-21']);
        $this->assertStringContainsString("SEQUENCE:4\r\n", $this->storedTodo('seq-1.ics'));
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function patchTask(string $url, array $patch): void
    {
        $etag = (string) $this->withBearer($this->userBearerToken())->getJson($url)->assertOk()->json('etag');
        $this->withBearer($this->userBearerToken())->withHeader('If-Match', $etag)->patchJson($url, $patch)->assertOk();
    }

    private function storedTodo(string $uri): string
    {
        return (string) CalendarObject::query()->where('uri', $uri)->firstOrFail()->calendardata;
    }
}
