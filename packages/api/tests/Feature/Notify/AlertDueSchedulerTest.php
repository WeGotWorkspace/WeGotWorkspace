<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Services\Notify\AlertDueScheduler;
use DateTimeImmutable;
use DateTimeZone;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class AlertDueSchedulerTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedInboxTaskListFor('bob');
    }

    public function test_due_calendar_alarm_creates_one_inbox_row_and_is_idempotent(): void
    {
        $now = new DateTimeImmutable('2026-09-12T12:00:00Z', new DateTimeZone('UTC'));
        $start = $now->modify('+15 minutes')->format('Ymd\THis\Z');
        $end = $now->modify('+75 minutes')->format('Ymd\THis\Z');
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:alarm-event-1\r\nSUMMARY:Standup\r\nDTSTART:{$start}\r\nDTEND:{$end}\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'alarm-event-1.ics', $ics);

        $fired = app(AlertDueScheduler::class)->scan($now);
        $this->assertGreaterThanOrEqual(1, $fired);

        $rows = Notification::query()->where('principal', 'bob')->where('action', 'alert_due')->get();
        $this->assertCount(1, $rows);
        $this->assertSame('/calendar', $rows[0]->navigate);
        $this->assertSame('Standup', $rows[0]->title);
        $this->assertSame('Sat 12 Sep · 12:15 – 13:15', $rows[0]->body);
        $this->assertIsArray($rows[0]->data);
        $this->assertSame('Standup', $rows[0]->data['summary'] ?? null);

        $again = app(AlertDueScheduler::class)->scan($now);
        $this->assertGreaterThanOrEqual(1, $again);
        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'alert_due')->count());
    }

    public function test_due_task_alarm_creates_inbox_row(): void
    {
        $now = new DateTimeImmutable('2026-09-12T12:00:00Z', new DateTimeZone('UTC'));
        $due = $now->modify('+10 minutes')->format('Ymd\THis\Z');
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:alarm-task-1\r\nSUMMARY:Pay rent\r\nDUE:{$due}\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $this->seedTaskViaPdo('bob', 'alarm-task-1.ics', $ics);

        app(AlertDueScheduler::class)->scan($now);
        $row = Notification::query()->where('principal', 'bob')->where('domain', 'tasks')->where('action', 'alert_due')->first();
        $this->assertNotNull($row);
        $this->assertSame('/tasks', $row->navigate);
        $this->assertSame('Pay rent', $row->title);
        $this->assertSame('Due Sat 12 Sep · 12:10', $row->body);
    }
}
