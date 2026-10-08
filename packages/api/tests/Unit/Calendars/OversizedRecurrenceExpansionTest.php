<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarEventExpansionService;
use Tests\TestCase;

/**
 * Long daily/weekly series must expand inside the window. A counted series
 * that still exceeds VObject's instance cap is skipped instead of thrown.
 */
final class OversizedRecurrenceExpansionTest extends TestCase
{
    private CalendarEventExpansionService $expansion;

    protected function setUp(): void
    {
        parent::setUp();
        $this->expansion = new CalendarEventExpansionService;
    }

    public function test_long_daily_series_returns_instances_inside_the_window(): void
    {
        $instances = $this->expand('long-daily', 'daily', null, [
            'DTSTART:19000101T100000Z',
            'DTEND:19000101T110000Z',
            'RRULE:FREQ=DAILY',
        ]);

        $this->assertSame([
            '2026-10-05T10:00:00Z',
            '2026-10-06T10:00:00Z',
            '2026-10-07T10:00:00Z',
        ], array_column($instances, 'start'));
    }

    public function test_shifted_series_honours_exdate_and_recurrence_id(): void
    {
        $ics = $this->calendar(
            $this->vevent('long-ex', [
                'DTSTART:19000101T100000Z',
                'DTEND:19000101T110000Z',
                'RRULE:FREQ=DAILY',
                'EXDATE:20261006T100000Z',
            ]).$this->vevent('long-ex', [
                'RECURRENCE-ID:20261007T100000Z',
                'DTSTART:20261007T150000Z',
                'DTEND:20261007T160000Z',
                'SUMMARY:Moved',
            ]),
        );

        $instances = $this->expansion->expandInWindow(
            $this->master('long-ex', 'daily'),
            $ics,
            'default',
            '2026-10-05T00:00:00Z',
            '2026-10-08T00:00:00Z',
        );

        $byRid = [];
        foreach ($instances as $instance) {
            $byRid[(string) $instance['recurrenceId']] = $instance['start'];
        }
        $this->assertSame('2026-10-05T10:00:00Z', $byRid['2026-10-05T10:00:00Z']);
        $this->assertArrayNotHasKey('2026-10-06T10:00:00Z', $byRid);
        $this->assertSame('2026-10-07T15:00:00Z', $byRid['2026-10-07T10:00:00Z']);
    }

    public function test_long_weekly_byday_series_returns_mondays_inside_the_window(): void
    {
        $instances = $this->expand(
            'long-weekly',
            'weekly',
            [['@type' => 'NDay', 'day' => 'mo']],
            [
                'DTSTART:19000101T100000Z',
                'DTEND:19000101T110000Z',
                'RRULE:FREQ=WEEKLY;BYDAY=MO',
            ],
            '2026-10-05T00:00:00Z',
            '2026-10-19T00:00:00Z',
        );

        $this->assertSame([
            '2026-10-05T10:00:00Z',
            '2026-10-12T10:00:00Z',
        ], array_column($instances, 'start'));
    }

    public function test_counted_daily_series_over_the_cap_is_skipped(): void
    {
        $instances = $this->expand('counted-daily', 'daily', null, [
            'DTSTART:19000101T100000Z',
            'DTEND:19000101T110000Z',
            'RRULE:FREQ=DAILY;COUNT=10000',
        ]);

        $this->assertSame([], $instances);
    }

    /**
     * @param  list<array<string, mixed>>|null  $byDay
     * @param  list<string>  $lines
     * @return list<array<string, mixed>>
     */
    private function expand(
        string $uid,
        string $frequency,
        ?array $byDay,
        array $lines,
        string $after = '2026-10-05T00:00:00Z',
        string $before = '2026-10-08T00:00:00Z',
    ): array {
        return $this->expansion->expandInWindow(
            $this->master($uid, $frequency, $byDay),
            $this->calendar($this->vevent($uid, $lines)),
            'default',
            $after,
            $before,
        );
    }

    /**
     * @param  list<array<string, mixed>>|null  $byDay
     * @return array<string, mixed>
     */
    private function master(string $uid, string $frequency, ?array $byDay = null): array
    {
        $rule = ['@type' => 'RecurrenceRule', 'frequency' => $frequency];
        if ($byDay !== null) {
            $rule['byDay'] = $byDay;
        }

        return [
            'id' => $uid,
            'uid' => $uid,
            'title' => $uid,
            'start' => '1900-01-01T10:00:00Z',
            'end' => '1900-01-01T11:00:00Z',
            'recurrenceRules' => [$rule],
        ];
    }

    /**
     * @param  list<string>  $lines
     */
    private function vevent(string $uid, array $lines): string
    {
        return "BEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:{$uid}\r\n".implode("\r\n", $lines)."\r\nEND:VEVENT\r\n";
    }

    private function calendar(string $vevents): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{$vevents}END:VCALENDAR\r\n";
    }
}
