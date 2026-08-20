<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarEventExpansionService;
use PHPUnit\Framework\TestCase;

final class CalendarEventExpansionServiceTest extends TestCase
{
    private CalendarEventExpansionService $expansion;

    protected function setUp(): void
    {
        parent::setUp();
        $this->expansion = new CalendarEventExpansionService;
    }

    public function test_expands_weekly_series_in_window(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-1\r\nSUMMARY:Weekly\r\nDTSTART:20260601T090000Z\r\nDTEND:20260601T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $master = [
            'id' => 'weekly-event',
            'uid' => 'weekly-1',
            'title' => 'Weekly',
            'start' => '2026-06-01T09:00:00Z',
            'end' => '2026-06-01T09:30:00Z',
            'recurrenceRules' => [
                ['@type' => 'RecurrenceRule', 'frequency' => 'weekly', 'byDay' => ['MO']],
            ],
        ];

        $instances = $this->expansion->expandInWindow(
            $master,
            $ics,
            'default',
            '2026-06-01T00:00:00Z',
            '2026-06-30T00:00:00Z',
        );

        $this->assertCount(5, $instances);
        $this->assertNull($instances[0]['recurrenceRules']);
        $this->assertSame('2026-06-01T09:00:00Z', $instances[0]['recurrenceId']);
        $this->assertSame('weekly-event/2026-06-01T09%3A00%3A00Z', $instances[0]['id']);
    }

    public function test_exdate_excludes_instance_from_expansion(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-ex\r\nSUMMARY:Weekly\r\nDTSTART:20260601T090000Z\r\nDTEND:20260601T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEXDATE:20260608T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $master = [
            'id' => 'weekly-ex',
            'uid' => 'weekly-ex',
            'title' => 'Weekly',
            'start' => '2026-06-01T09:00:00Z',
            'end' => '2026-06-01T09:30:00Z',
            'recurrenceRules' => [
                ['@type' => 'RecurrenceRule', 'frequency' => 'weekly', 'byDay' => ['MO']],
            ],
            'excludedRecurrenceDates' => ['2026-06-08T09:00:00Z'],
        ];

        $instances = $this->expansion->expandInWindow(
            $master,
            $ics,
            'default',
            '2026-06-01T00:00:00Z',
            '2026-06-30T00:00:00Z',
        );

        $recurrenceIds = array_column($instances, 'recurrenceId');
        $this->assertNotContains('2026-06-08T09:00:00Z', $recurrenceIds);
    }

    public function test_expansion_inherits_master_declined_over_stale_instance_partstat(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-declined\r\nSUMMARY:Weekly\r\n"
            ."DTSTART:20260601T090000Z\r\nDTEND:20260601T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\n"
            ."ATTENDEE;PARTSTAT=DECLINED:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nBEGIN:VEVENT\r\nUID:weekly-declined\r\n"
            ."RECURRENCE-ID:20260608T090000Z\r\nDTSTART:20260608T100000Z\r\nSUMMARY:Moved\r\n"
            ."ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
        $master = [
            'id' => 'weekly-declined',
            'uid' => 'weekly-declined',
            'title' => 'Weekly',
            'start' => '2026-06-01T09:00:00Z',
            'end' => '2026-06-01T09:30:00Z',
            'recurrenceRules' => [
                ['@type' => 'RecurrenceRule', 'frequency' => 'weekly', 'byDay' => ['MO']],
            ],
            'participants' => [
                'att1' => [
                    '@type' => 'Participant',
                    'email' => 'carol@example.test',
                    'roles' => ['attendee' => true],
                    'participationStatus' => 'declined',
                ],
            ],
        ];

        $instances = $this->expansion->expandInWindow(
            $master,
            $ics,
            'default',
            '2026-06-01T00:00:00Z',
            '2026-06-30T00:00:00Z',
        );

        $this->assertNotSame([], $instances);
        foreach ($instances as $instance) {
            $this->assertSame(
                'declined',
                $this->participantStatus($instance, 'carol@example.test'),
            );
        }
    }

    public function test_expansion_keeps_later_this_instance_accept_after_series_decline(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-later\r\nSUMMARY:Weekly\r\n"
            ."DTSTART:20260601T090000Z\r\nDTEND:20260601T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\n"
            ."ATTENDEE;PARTSTAT=DECLINED:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nBEGIN:VEVENT\r\nUID:weekly-later\r\n"
            ."RECURRENCE-ID:20260608T090000Z\r\nDTSTART:20260608T090000Z\r\n"
            ."ATTENDEE;PARTSTAT=ACCEPTED:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
        $master = [
            'id' => 'weekly-later',
            'uid' => 'weekly-later',
            'title' => 'Weekly',
            'start' => '2026-06-01T09:00:00Z',
            'end' => '2026-06-01T09:30:00Z',
            'recurrenceRules' => [
                ['@type' => 'RecurrenceRule', 'frequency' => 'weekly', 'byDay' => ['MO']],
            ],
            'participants' => [
                'att1' => [
                    '@type' => 'Participant',
                    'email' => 'carol@example.test',
                    'roles' => ['attendee' => true],
                    'participationStatus' => 'declined',
                ],
            ],
        ];

        $instances = $this->expansion->expandInWindow(
            $master,
            $ics,
            'default',
            '2026-06-01T00:00:00Z',
            '2026-06-15T00:00:00Z',
        );

        $byRid = [];
        foreach ($instances as $instance) {
            $rid = (string) ($instance['recurrenceId'] ?? '');
            $byRid[$rid] = $this->participantStatus($instance, 'carol@example.test');
        }
        $this->assertSame('declined', $byRid['2026-06-01T09:00:00Z']);
        $this->assertSame('accepted', $byRid['2026-06-08T09:00:00Z']);
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function participantStatus(array $event, string $email): ?string
    {
        foreach ($event['participants'] ?? [] as $participant) {
            if (! is_array($participant)) {
                continue;
            }
            if (strtolower((string) ($participant['email'] ?? '')) !== strtolower($email)) {
                continue;
            }

            return strtolower((string) ($participant['participationStatus'] ?? ''));
        }

        return null;
    }
}
