<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarsEventsQueryTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_query_returns_ids_for_calendar(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'query-basic.ics', $this->sampleIcs(
            'Query Basic',
            null,
            '20260901T100000Z',
            '20260901T110000Z',
        ));

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => ['inCalendars' => ['default']],
            ])
            ->assertOk();

        $this->assertContains($eventId, $response->json('ids'));
        $response->assertJsonPath('position', 0);
        $response->assertJsonPath('canCalculateChanges', false);
        $this->assertSame(count($response->json('ids')), $response->json('total'));

        // Single queried calendar: queryState is that calendar's /changes state.
        $changes = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default')
            ->assertOk();
        $this->assertSame((string) $changes->json('newState'), (string) $response->json('queryState'));
    }

    public function test_query_state_composes_across_queried_calendars(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/calendars', ['name' => 'Second', 'id' => 'second'])
            ->assertCreated();

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => ['inCalendars' => ['second', 'default']],
            ])
            ->assertOk()
            ->assertJsonPath('canCalculateChanges', false);

        // Composite state sorted by uri regardless of request order.
        $this->assertMatchesRegularExpression('/^2:default:\d+,second:\d+$/', (string) $response->json('queryState'));
    }

    public function test_query_time_range_matches_intersecting_events_only(): void
    {
        $inWindow = $this->seedEventViaPdo('bob', 'in-window.ics', $this->sampleIcs(
            'In Window',
            null,
            '20260901T100000Z',
            '20260901T110000Z',
        ));
        $outOfWindow = $this->seedEventViaPdo('bob', 'out-window.ics', $this->sampleIcs(
            'Out Of Window',
            null,
            '20261001T100000Z',
            '20261001T110000Z',
        ));
        $straddling = $this->seedEventViaPdo('bob', 'straddle-window.ics', $this->sampleIcs(
            'Straddling',
            null,
            '20260831T230000Z',
            '20260901T010000Z',
        ));

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => [
                    'inCalendars' => ['default'],
                    'after' => '2026-09-01T00:00:00Z',
                    'before' => '2026-09-08T00:00:00Z',
                ],
            ])
            ->assertOk();

        $ids = $response->json('ids');
        $this->assertContains($inWindow, $ids);
        $this->assertContains($straddling, $ids);
        $this->assertNotContains($outOfWindow, $ids);
    }

    public function test_query_recurring_event_matches_when_instance_falls_in_window(): void
    {
        // Weekly series starting far before the window; an occurrence lands inside.
        $recurringId = $this->seedEventViaPdo('bob', 'weekly.ics', $this->recurringIcs(
            'Weekly Standup',
            '20260106T090000Z',
            '20260106T093000Z',
        ));

        $matching = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => [
                    'inCalendars' => ['default'],
                    'after' => '2026-09-01T00:00:00Z',
                    'before' => '2026-09-08T00:00:00Z',
                ],
            ])
            ->assertOk();
        $this->assertContains($recurringId, $matching->json('ids'));

        // Window between two weekly occurrences (Tue 09:00Z series; window covers Wed-Fri).
        $nonMatching = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => [
                    'inCalendars' => ['default'],
                    'after' => '2026-09-02T00:00:00Z',
                    'before' => '2026-09-04T00:00:00Z',
                ],
            ])
            ->assertOk();
        $this->assertNotContains($recurringId, $nonMatching->json('ids'));
    }

    public function test_query_multi_vevent_object_matches_per_sub_vevent(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            ."BEGIN:VEVENT\r\nUID:uid-in\r\nSUMMARY:Sub In Window\r\nDTSTART:20260902T100000Z\r\nDTEND:20260902T110000Z\r\nEND:VEVENT\r\n"
            ."BEGIN:VEVENT\r\nUID:uid-out\r\nSUMMARY:Sub Out Of Window\r\nDTSTART:20261002T100000Z\r\nDTEND:20261002T110000Z\r\nEND:VEVENT\r\n"
            ."END:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'multi-query.ics', $ics);

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => [
                    'inCalendars' => ['default'],
                    'after' => '2026-09-01T00:00:00Z',
                    'before' => '2026-09-08T00:00:00Z',
                ],
            ])
            ->assertOk();

        $ids = $response->json('ids');
        $this->assertContains('multi-query#uid-in', $ids);
        $this->assertNotContains('multi-query#uid-out', $ids);
    }

    public function test_query_title_filter_is_case_insensitive_substring(): void
    {
        $matching = $this->seedEventViaPdo('bob', 'title-match.ics', $this->sampleIcs('Quarterly Planning'));
        $other = $this->seedEventViaPdo('bob', 'title-other.ics', $this->sampleIcs('Daily Standup'));

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => [
                    'inCalendars' => ['default'],
                    'title' => 'quarterly',
                ],
            ])
            ->assertOk();

        $ids = $response->json('ids');
        $this->assertContains($matching, $ids);
        $this->assertNotContains($other, $ids);
    }

    public function test_query_sort_position_and_limit(): void
    {
        $first = $this->seedEventViaPdo('bob', 'sorted-a.ics', $this->sampleIcs('Sorted A', null, '20260901T090000Z', '20260901T100000Z'));
        $second = $this->seedEventViaPdo('bob', 'sorted-b.ics', $this->sampleIcs('Sorted B', null, '20260902T090000Z', '20260902T100000Z'));
        $third = $this->seedEventViaPdo('bob', 'sorted-c.ics', $this->sampleIcs('Sorted C', null, '20260903T090000Z', '20260903T100000Z'));

        $window = [
            'inCalendars' => ['default'],
            'after' => '2026-09-01T00:00:00Z',
            'before' => '2026-09-05T00:00:00Z',
        ];

        $ascending = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => $window,
                'sort' => [['property' => 'start', 'isAscending' => true]],
            ])
            ->assertOk()
            ->assertJsonPath('total', 3);
        $this->assertSame([$first, $second, $third], $ascending->json('ids'));

        $paged = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => $window,
                'sort' => [['property' => 'start', 'isAscending' => false]],
                'position' => 1,
                'limit' => 1,
            ])
            ->assertOk()
            ->assertJsonPath('total', 3)
            ->assertJsonPath('position', 1);
        $this->assertSame([$second], $paged->json('ids'));
    }

    public function test_query_multiple_calendars_and_isolation(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/calendars', ['name' => 'Second', 'id' => 'second'])
            ->assertCreated();

        $defaultEvent = $this->seedEventViaPdo('bob', 'iso-default.ics', $this->sampleIcs('Iso Default'));
        $secondEvent = $this->seedEventViaPdo('bob', 'iso-second.ics', $this->sampleIcs('Iso Second'), 'second');
        $carolEvent = $this->seedEventViaPdo('carol', 'iso-carol.ics', $this->sampleIcs('Iso Carol'));

        $both = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => ['inCalendars' => ['default', 'second']],
            ])
            ->assertOk();
        $ids = $both->json('ids');
        $this->assertContains($defaultEvent, $ids);
        $this->assertContains($secondEvent, $ids);
        // Carol's event shares the uri-derived id namespace but must not leak.
        $this->assertNotContains($carolEvent, $ids);

        $defaultOnly = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => ['inCalendars' => ['default']],
            ])
            ->assertOk();
        $this->assertNotContains($secondEvent, $defaultOnly->json('ids'));
    }

    public function test_query_unknown_calendar_returns_404(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => ['inCalendars' => ['nope']],
            ])
            ->assertNotFound();
    }

    public function test_query_after_without_before_is_rejected(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => [
                    'inCalendars' => ['default'],
                    'after' => '2026-09-01T00:00:00Z',
                ],
            ])
            ->assertBadRequest()
            ->assertJsonPath('code', 'bad_request');
    }

    private function recurringIcs(string $summary, string $start, string $end): string
    {
        $uid = 'urn:uuid:recurring-'.md5($summary);

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\n"
            ."DTSTART:{$start}\r\nDTEND:{$end}\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }
}
