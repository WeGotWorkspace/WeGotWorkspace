<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarEventExpansionService;
use App\Services\Calendars\CalendarSchedulingRsvpScope;
use PHPUnit\Framework\TestCase;

final class CalendarSchedulingRsvpScopeTest extends TestCase
{
    private CalendarSchedulingRsvpScope $scope;

    protected function setUp(): void
    {
        parent::setUp();
        $this->scope = new CalendarSchedulingRsvpScope(new CalendarEventExpansionService);
    }

    public function test_one_off_updates_master_participants(): void
    {
        $event = $this->seriesEvent(recurring: false);
        $patch = $this->scope->patch(
            $event,
            'declined',
            'this',
            '2030-01-22T10:00:00Z',
            null,
            $this->isCarol(...),
        );

        $this->assertSame('declined', $patch['participants']['att1']['participationStatus']);
        $this->assertArrayNotHasKey('recurrenceOverrides', $patch);
    }

    public function test_this_instance_keeps_master_and_writes_override(): void
    {
        $event = $this->seriesEvent();
        $patch = $this->scope->patch(
            $event,
            'declined',
            'this',
            '2030-01-22T10:00:00Z',
            null,
            $this->isCarol(...),
        );

        $this->assertArrayNotHasKey('participants', $patch);
        $this->assertSame(
            'declined',
            $patch['recurrenceOverrides']['2030-01-22T10:00:00Z']['participants']['att1']['participationStatus'],
        );
    }

    public function test_future_from_second_instance_stamps_past_override(): void
    {
        $event = $this->seriesEvent();
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-1\r\nSUMMARY:Standup\r\n"
            ."DTSTART:20300115T100000Z\r\nDTEND:20300115T103000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=TU\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";

        $patch = $this->scope->patch(
            $event,
            'declined',
            'future',
            '2030-01-22T10:00:00Z',
            null,
            $this->isCarol(...),
            $ics,
        );

        $this->assertSame('declined', $patch['participants']['att1']['participationStatus']);
        $this->assertSame(
            'accepted',
            $patch['recurrenceOverrides']['2030-01-15T10:00:00Z']['participants']['att1']['participationStatus'],
        );
        $this->assertArrayNotHasKey('2030-01-22T10:00:00Z', $patch['recurrenceOverrides'] ?? []);
    }

    public function test_series_wide_decline_rewrites_stale_instance_partstat(): void
    {
        $event = $this->seriesEvent();
        $event['recurrenceOverrides'] = [
            '2030-01-22T10:00:00Z' => [
                'title' => 'Moved standup',
                'participants' => [
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'roles' => ['attendee'],
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ],
        ];

        $patch = $this->scope->patch(
            $event,
            'declined',
            null,
            null,
            null,
            $this->isCarol(...),
        );

        $this->assertSame('declined', $patch['participants']['att1']['participationStatus']);
        $this->assertSame(
            'declined',
            $patch['recurrenceOverrides']['2030-01-22T10:00:00Z']['participants']['att1']['participationStatus'],
        );
        $this->assertSame(
            'Moved standup',
            $patch['recurrenceOverrides']['2030-01-22T10:00:00Z']['title'],
        );
    }

    public function test_series_wide_decline_leaves_timing_only_overrides_untouched(): void
    {
        $event = $this->seriesEvent();
        $event['recurrenceOverrides'] = [
            '2030-01-22T10:00:00Z' => [
                'start' => '2030-01-22T11:00:00Z',
            ],
        ];

        $patch = $this->scope->patch(
            $event,
            'declined',
            null,
            null,
            null,
            $this->isCarol(...),
        );

        $this->assertSame('declined', $patch['participants']['att1']['participationStatus']);
        $this->assertArrayNotHasKey('recurrenceOverrides', $patch);
    }

    public function test_future_from_series_start_is_master_only(): void
    {
        $event = $this->seriesEvent();
        $patch = $this->scope->patch(
            $event,
            'accepted',
            'future',
            '2030-01-15T10:00:00Z',
            null,
            $this->isCarol(...),
        );

        $this->assertSame('accepted', $patch['participants']['att1']['participationStatus']);
        $this->assertArrayNotHasKey('recurrenceOverrides', $patch);
    }

    private function isCarol(mixed $email): bool
    {
        return is_string($email) && strtolower($email) === 'carol@example.test';
    }

    /**
     * @return array<string, mixed>
     */
    private function seriesEvent(bool $recurring = true): array
    {
        $event = [
            'uid' => 'weekly-1',
            'start' => '2030-01-15T10:00:00Z',
            'participants' => [
                'org' => [
                    '@type' => 'Participant',
                    'email' => 'bob@example.test',
                    'roles' => ['owner'],
                    'participationStatus' => 'accepted',
                ],
                'att1' => [
                    '@type' => 'Participant',
                    'email' => 'carol@example.test',
                    'roles' => ['attendee'],
                    'participationStatus' => 'accepted',
                ],
            ],
        ];
        if ($recurring) {
            $event['recurrenceRules'] = [
                ['@type' => 'RecurrenceRule', 'frequency' => 'weekly'],
            ];
        }

        return $event;
    }
}
