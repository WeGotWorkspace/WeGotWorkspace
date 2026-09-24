<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\AlertDueNotify;
use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\TestCase;

final class AlertDueNotifyTest extends TestCase
{
    public function test_calendar_facts_and_formatted_copy(): void
    {
        $start = new DateTimeImmutable('2026-09-12T12:15:00Z', new DateTimeZone('UTC'));
        $end = new DateTimeImmutable('2026-09-12T13:15:00Z', new DateTimeZone('UTC'));
        $data = AlertDueNotify::eventData(
            'calendar',
            'Standup',
            $start,
            $end,
            '/calendar',
            'calendar.alert_due:1',
        );

        $this->assertSame('Standup', $data['summary']);
        $this->assertSame('/calendar', $data['navigate']);
        $this->assertArrayNotHasKey('title', $data);

        $copy = AlertDueNotify::formatCopy('calendar', $data);
        $this->assertSame('Standup', $copy['title']);
        $this->assertSame('Sat 12 Sep · 12:15 – 13:15', $copy['body']);
    }

    public function test_task_copy_prefixes_due(): void
    {
        $due = new DateTimeImmutable('2026-09-12T12:10:00Z', new DateTimeZone('UTC'));
        $data = AlertDueNotify::eventData(
            'tasks',
            'Pay rent',
            $due,
            $due,
            '/tasks',
            'tasks.alert_due:1',
        );

        $copy = AlertDueNotify::formatCopy('tasks', $data);
        $this->assertSame('Pay rent', $copy['title']);
        $this->assertSame('Due Sat 12 Sep · 12:10', $copy['body']);
    }

    public function test_empty_summary_falls_back_to_reminder_title(): void
    {
        $start = new DateTimeImmutable('2026-09-12T12:00:00Z', new DateTimeZone('UTC'));
        $calendar = AlertDueNotify::eventData('calendar', '  ', $start, null, '/calendar', 't');
        $task = AlertDueNotify::eventData('tasks', '', $start, null, '/tasks', 't');

        $this->assertSame('Calendar reminder', AlertDueNotify::formatCopy('calendar', $calendar)['title']);
        $this->assertSame('Task reminder', AlertDueNotify::formatCopy('tasks', $task)['title']);
        $this->assertSame('Sat 12 Sep · 12:00', AlertDueNotify::formatCopy('calendar', $calendar)['body']);
    }
}
