<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Models\MeetReservation;
use App\Services\Calendars\CalendarMeetLinkWriteHook;
use App\Services\Meet\MeetReservationService;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Event;
use RuntimeException;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarMeetLinkWriteHookTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    private const ROOM = 'abcd-efgh-ijkl';

    private const HREF = 'https://workspace.test/meet/guest?room='.self::ROOM;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
        config(['app.url' => 'https://workspace.test']);
    }

    public function test_single_event_reserve_sets_end_plus_grace_without_a_second_write(): void
    {
        $hook = app(CalendarMeetLinkWriteHook::class);
        $hook->afterPersist(
            $this->eventIcs('meet-single-1', '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z'),
            $this->eventIcs('meet-single-1', '2030-01-01T09:00:00Z', '2030-01-01T10:00:00Z'),
            'u:bob',
            'u:bob',
        );

        $row = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($row);
        $this->assertTrue($row->expires_at?->equalTo(Carbon::parse('2030-01-08T11:00:00Z')));

        $hook->afterPersist(
            $this->eventIcs('meet-single-1', '2030-01-15T10:00:00Z', '2030-01-15T12:00:00Z'),
            $this->eventIcs('meet-single-1', '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z'),
            'u:carol',
            'u:carol',
        );

        $moved = MeetReservation::query()->find(self::ROOM);
        $this->assertNotNull($moved);
        $this->assertSame('u:bob', $moved->owner_principal);
        $this->assertSame('u:bob', $moved->created_by);
        $this->assertTrue($moved->expires_at?->equalTo(Carbon::parse('2030-01-22T12:00:00Z')));
    }

    public function test_series_reserve_clears_expires_at_while_attached(): void
    {
        app(MeetReservationService::class)->reserve(
            self::ROOM,
            'u:bob',
            'u:bob',
            Carbon::parse('2030-02-01T00:00:00Z'),
        );

        app(CalendarMeetLinkWriteHook::class)->afterPersist(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meet-series-1\r\n"
            ."DTSTART:20300115T100000Z\r\nDTEND:20300115T103000Z\r\nRRULE:FREQ=WEEKLY\r\n"
            .'URL:'.self::HREF."\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
            null,
            'u:bob',
            'u:bob',
        );

        $this->assertNull(MeetReservation::query()->find(self::ROOM)?->expires_at);
    }

    public function test_reserve_failure_logs_structured_warning_and_stays_fail_open(): void
    {
        Event::fake([MessageLogged::class]);
        MeetReservation::creating(static function (): never {
            throw new RuntimeException('db down');
        });

        app(CalendarMeetLinkWriteHook::class)->afterPersist(
            $this->eventIcs('meet-log-1', '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z'),
            null,
            'u:bob',
            'u:bob',
        );

        $this->assertNull(MeetReservation::query()->find(self::ROOM));
        Event::assertDispatched(MessageLogged::class, function (MessageLogged $event): bool {
            return $event->level === 'warning'
                && $event->message === CalendarMeetLinkWriteHook::RESERVE_FAILED_LOG
                && ($event->context['event_uid'] ?? null) === 'meet-log-1'
                && ($event->context['room_ids'] ?? null) === [self::ROOM]
                && ($event->context['exception'] ?? null) === RuntimeException::class
                && ($event->context['message'] ?? null) === 'db down';
        });
    }

    private function eventIcs(string $uid, string $start, string $end): string
    {
        $startIcs = str_replace(['-', ':'], '', $start);
        $endIcs = str_replace(['-', ':'], '', $end);

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:Meet\r\n"
            ."DTSTART:{$startIcs}\r\nDTEND:{$endIcs}\r\n"
            .'URL:'.self::HREF."\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }
}
