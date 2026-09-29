<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Events\EventDispatch;
use App\Services\Notify\AlertDueScheduler;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionMethod;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Component\VTodo;
use Sabre\VObject\Reader;
use Tests\TestCase;

final class AlertDueSchedulerEndDateTest extends TestCase
{
    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function resolvedEndProvider(): array
    {
        return [
            'vtodo due' => [
                <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:task-due
DTSTART:20260912T120000Z
DUE:20260912T150000Z
END:VTODO
END:VCALENDAR
ICS,
                '2026-09-12T15:00:00+00:00',
            ],
            'vevent dtend' => [
                <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-dtend
DTSTART:20260912T120000Z
DTEND:20260912T130000Z
END:VEVENT
END:VCALENDAR
ICS,
                '2026-09-12T13:00:00+00:00',
            ],
            'vevent duration' => [
                <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-duration
DTSTART:20260912T120000Z
DURATION:PT90M
END:VEVENT
END:VCALENDAR
ICS,
                '2026-09-12T13:30:00+00:00',
            ],
        ];
    }

    #[DataProvider('resolvedEndProvider')]
    public function test_end_resolution(string $ics, string $expected): void
    {
        $end = $this->endDate($ics);

        $this->assertSame($expected, $end->format(DATE_ATOM));
    }

    public function test_invalid_duration_falls_back_to_dtstart_and_logs_a_warning(): void
    {
        $ics = <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-bad-duration
DTSTART:20260912T120000Z
DURATION:NOT-A-DURATION
END:VEVENT
END:VCALENDAR
ICS;

        $warnings = [];
        Log::listen(function (MessageLogged $event) use (&$warnings): void {
            if ($event->level === 'warning') {
                $warnings[] = $event->message;
            }
        });

        $end = $this->endDate($ics);

        $this->assertSame('2026-09-12T12:00:00+00:00', $end->format(DATE_ATOM));
        $this->assertNotSame([], $warnings);
        $this->assertStringContainsString('DURATION', $warnings[0]);
    }

    private function endDate(string $ics): DateTimeImmutable
    {
        $calendar = Reader::read($ics);
        $this->assertInstanceOf(VCalendar::class, $calendar);
        $component = $calendar->VTODO ?? $calendar->VEVENT;
        $this->assertTrue($component instanceof VEvent || $component instanceof VTodo);
        $startProp = $component->DTSTART;
        $this->assertNotNull($startProp);
        $start = DateTimeImmutable::createFromInterface($startProp->getDateTime())
            ->setTimezone(new DateTimeZone('UTC'));

        $method = new ReflectionMethod(AlertDueScheduler::class, 'endDate');
        $resolved = $method->invoke(new AlertDueScheduler(new EventDispatch), $component, $start);
        $this->assertInstanceOf(DateTimeImmutable::class, $resolved);

        return $resolved;
    }
}
