<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\CalendarInviteNotify;
use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\TestCase;

final class CalendarInviteNotifyTest extends TestCase
{
    public function test_facts_and_formatted_copy_include_when_and_where(): void
    {
        $start = new DateTimeImmutable('2026-09-19T09:00:00Z', new DateTimeZone('UTC'));
        $end = new DateTimeImmutable('2026-09-19T12:00:00Z', new DateTimeZone('UTC'));
        $data = CalendarInviteNotify::eventData(
            'Nathalie',
            'Zaterdag Open',
            $start,
            $end,
            'Dorpsstraat',
            'uid-1',
        );

        $this->assertSame('Nathalie', $data['actor']);
        $this->assertSame('Zaterdag Open', $data['summary']);
        $this->assertSame('Dorpsstraat', $data['location']);
        $this->assertSame('/calendar', $data['navigate']);
        $this->assertSame('calendar.invite:uid-1', $data['tag']);
        $this->assertSame('calendar.invite:uid-1', $data['dedupe_key']);
        $this->assertTrue($data['supersede']);
        $this->assertArrayNotHasKey('title', $data);

        $copy = CalendarInviteNotify::formatCopy($data);
        $this->assertSame('Nathalie invited you to Zaterdag Open', $copy['title']);
        $this->assertSame('Sat 19 Sep · 09:00 – 12:00 · Dorpsstraat', $copy['body']);
    }

    public function test_empty_summary_falls_back(): void
    {
        $data = CalendarInviteNotify::eventData('Bob', '  ', null, null, null, 'uid-2');

        $this->assertSame('Bob invited you to an event', CalendarInviteNotify::formatCopy($data)['title']);
        $this->assertNull(CalendarInviteNotify::formatCopy($data)['body']);
    }

    public function test_clear_data_marks_dedupe_for_withdraw(): void
    {
        $data = CalendarInviteNotify::clearData('uid-3');

        $this->assertSame('calendar.invite:uid-3', $data['dedupe_key']);
        $this->assertTrue($data['clear']);
    }
}
