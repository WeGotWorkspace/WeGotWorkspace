<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarEventsTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use OptimisticConcurrencyTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_list_events_in_calendar(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'team-meeting.ics', $this->sampleIcs('Team Meeting'));

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events?calendarId=default');

        $response->assertOk()
            ->assertJsonCount(1, 'list')
            ->assertJsonPath('list.0.id', $eventId)
            ->assertJsonPath('list.0.@type', 'Event')
            ->assertJsonPath('list.0.calendarIds.default', true)
            ->assertJsonPath('list.0.title', 'Team Meeting');
    }

    public function test_show_event_returns_jmap_event(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'team-meeting.ics', $this->sampleIcs('Team Meeting'));

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId);

        $response->assertOk()
            ->assertJsonPath('id', $eventId)
            ->assertJsonPath('@type', 'Event')
            ->assertJsonPath('title', 'Team Meeting')
            ->assertJsonPath('calendarIds.default', true);
    }

    public function test_create_event_minimal_body_succeeds(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events', [
                'calendarIds' => ['default' => true],
                'title' => 'Minimal Event',
                'start' => '2026-06-20T10:00:00Z',
                'end' => '2026-06-20T11:00:00Z',
            ]);

        $response->assertCreated()
            ->assertJsonPath('@type', 'Event')
            ->assertJsonPath('title', 'Minimal Event');

        $eventId = (string) $response->json('id');
        $this->assertNotSame('', $eventId);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId)
            ->assertOk()
            ->assertJsonPath('title', 'Minimal Event');
    }

    public function test_create_rejects_server_owned_fields(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events', [
                'calendarIds' => ['default' => true],
                'id' => 'client-id',
                '@type' => 'Event',
                'title' => 'Rejected',
                'start' => '2026-06-20T10:00:00Z',
                'end' => '2026-06-20T11:00:00Z',
            ])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_update_event_replaces_fields(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'team-meeting.ics', $this->sampleIcs('Team Meeting'));
        $url = '/api/v1/calendars/events/'.$eventId;

        $response = $this->withBearer($this->userBearerToken())
            ->putJson($url, [
                'calendarIds' => ['default' => true],
                'title' => 'Updated Meeting',
                'start' => '2026-06-21T10:00:00Z',
                'end' => '2026-06-21T11:00:00Z',
            ], $this->withIfMatch($this->fetchEtagFromGet($url)));

        $response->assertOk()
            ->assertJsonPath('title', 'Updated Meeting');
    }

    public function test_patch_event_merges_fields(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'team-meeting.ics', $this->sampleIcs('Team Meeting'));
        $url = '/api/v1/calendars/events/'.$eventId;

        $response = $this->withBearer($this->userBearerToken())
            ->patchJson($url, [
                'title' => 'Patched Title',
            ], $this->withIfMatch($this->fetchEtagFromGet($url)));

        $response->assertOk()
            ->assertJsonPath('title', 'Patched Title')
            ->assertJsonPath('calendarIds.default', true);
    }

    public function test_delete_event_returns_ok(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'team-meeting.ics', $this->sampleIcs('Team Meeting'));
        $url = '/api/v1/calendars/events/'.$eventId;

        $this->withBearer($this->userBearerToken())
            ->deleteJson($url, [], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId)
            ->assertNotFound();
    }

    public function test_list_requires_calendar_id(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events')
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_recurring_event_returns_rrule_not_expanded_instances(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:recur-1\r\nSUMMARY:Weekly Standup\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'weekly-standup.ics', $ics);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId);

        $response->assertOk()
            ->assertJsonPath('title', 'Weekly Standup')
            ->assertJsonCount(1, 'recurrenceRules')
            ->assertJsonPath('recurrenceRules.0.frequency', 'weekly')
            ->assertJsonPath('recurrenceRules.0.byDay.0', ['@type' => 'NDay', 'day' => 'mo']);

        $this->assertArrayNotHasKey('instances', $response->json());
    }

    public function test_expand_recurrences_requires_after_and_before(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events?calendarId=default&expandRecurrences=true')
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_expand_recurrences_returns_instances_in_window(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:expand-api\r\nSUMMARY:Daily\r\nDTSTART:20260601T090000Z\r\nDTEND:20260601T093000Z\r\nRRULE:FREQ=DAILY;COUNT=5\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'daily-expand.ics', $ics);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events?calendarId=default&expandRecurrences=true&after=2026-06-01T00:00:00Z&before=2026-06-04T00:00:00Z');

        $response->assertOk();
        $list = $response->json('list');
        $this->assertCount(3, $list);
        $this->assertNull($list[0]['recurrenceRules']);
        $this->assertSame('2026-06-01T09:00:00Z', $list[0]['recurrenceId']);
        $this->assertStringStartsWith($eventId.'/', $list[0]['id']);
    }

    public function test_multi_vevent_ics_yields_composite_event_ids(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:first\r\nSUMMARY:Primary Event\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:second\r\nSUMMARY:Secondary Event\r\nDTSTART:20260611T090000Z\r\nDTEND:20260611T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'multi-event.ics', $ics);

        $list = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events?calendarId=default')
            ->assertOk()
            ->json('list');

        $this->assertCount(2, $list);
        $ids = array_column($list, 'id');
        $this->assertContains('multi-event#first', $ids);
        $this->assertContains('multi-event#second', $ids);
    }

    public function test_patch_composite_event_updates_only_target_vevent(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:first\r\nSUMMARY:Primary Event\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:second\r\nSUMMARY:Secondary Event\r\nDTSTART:20260611T090000Z\r\nDTEND:20260611T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'multi-event.ics', $ics);
        $secondUrl = '/api/v1/calendars/events/'.rawurlencode('multi-event#second');

        $this->withBearer($this->userBearerToken())
            ->patchJson($secondUrl, [
                'title' => 'Patched Secondary',
            ], $this->withIfMatch($this->fetchEtagFromGet($secondUrl)))
            ->assertOk()
            ->assertJsonPath('title', 'Patched Secondary')
            ->assertJsonPath('id', 'multi-event#second');

        $stored = CalendarObject::query()->where('uri', 'multi-event.ics')->first();
        $this->assertNotNull($stored);
        $blob = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('SUMMARY:Primary Event', $blob);
        $this->assertStringContainsString('SUMMARY:Patched Secondary', $blob);
        $this->assertStringNotContainsString('SUMMARY:Secondary Event', $blob);
    }

    public function test_delete_composite_event_removes_only_target_vevent(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:first\r\nSUMMARY:Primary Event\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:second\r\nSUMMARY:Secondary Event\r\nDTSTART:20260611T090000Z\r\nDTEND:20260611T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'multi-event.ics', $ics);
        $secondUrl = '/api/v1/calendars/events/'.rawurlencode('multi-event#second');

        $this->withBearer($this->userBearerToken())
            ->deleteJson($secondUrl, [], $this->withIfMatch($this->fetchEtagFromGet($secondUrl)))
            ->assertOk()
            ->assertJsonPath('ok', true);

        $stored = CalendarObject::query()->where('uri', 'multi-event.ics')->first();
        $this->assertNotNull($stored);
        $blob = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('SUMMARY:Primary Event', $blob);
        $this->assertStringNotContainsString('UID:second', $blob);
    }

    public function test_delete_last_vevent_removes_calendar_object(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:only\r\nSUMMARY:Solo Event\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'solo-event.ics', $ics);
        $url = '/api/v1/calendars/events/'.$eventId;

        $this->withBearer($this->userBearerToken())
            ->deleteJson($url, [], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertOk();

        $this->assertNull(
            CalendarObject::query()->where('uri', 'solo-event.ics')->first()
        );
    }

    public function test_recurring_with_override_returns_single_event_with_recurrence_overrides(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:series-api\r\nSUMMARY:Weekly Sync\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series-api\r\nRECURRENCE-ID:20260617T090000Z\r\nDTSTART:20260617T140000Z\r\nDTEND:20260617T143000Z\r\nSUMMARY:Weekly Sync (moved)\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'weekly-sync.ics', $ics);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId);

        $response->assertOk()
            ->assertJsonPath('uid', 'series-api')
            ->assertJsonPath('recurrenceOverrides.2026-06-17T09:00:00Z.start', '2026-06-17T14:00:00Z')
            ->assertJsonPath('recurrenceOverrides.2026-06-17T09:00:00Z.title', 'Weekly Sync (moved)');

        $list = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events?calendarId=default')
            ->assertOk()
            ->json('list');

        $this->assertCount(1, $list);
        $this->assertSame($eventId, $list[0]['id']);
    }

    public function test_patch_recurrence_overrides_updates_single_instance_in_ics(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:series-patch\r\nSUMMARY:Daily Standup\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T093000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'daily-standup.ics', $ics);

        $url = '/api/v1/calendars/events/'.$eventId;
        $this->withBearer($this->userBearerToken())
            ->patchJson($url, [
                'recurrenceOverrides' => [
                    '2026-06-12T09:00:00Z' => [
                        'start' => '2026-06-12T14:00:00Z',
                        'end' => '2026-06-12T14:30:00Z',
                        'title' => 'Daily Standup (rescheduled)',
                    ],
                    '2026-06-13T09:00:00Z' => [
                        'excluded' => true,
                    ],
                ],
            ], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertOk()
            ->assertJsonPath('recurrenceOverrides.2026-06-12T09:00:00Z.start', '2026-06-12T14:00:00Z')
            ->assertJsonPath('recurrenceOverrides.2026-06-13T09:00:00Z.excluded', true);

        $stored = CalendarObject::query()->where('uri', 'daily-standup.ics')->first();
        $this->assertNotNull($stored);
        $blob = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('RRULE:FREQ=DAILY', $blob);
        $this->assertStringContainsString('RECURRENCE-ID:20260612T090000Z', $blob);
        $this->assertStringContainsString('DTSTART:20260612T140000Z', $blob);
        $this->assertStringContainsString('SUMMARY:Daily Standup (rescheduled)', $blob);
        $this->assertStringContainsString('RECURRENCE-ID:20260613T090000Z', $blob);
        $this->assertStringContainsString('STATUS:CANCELLED', $blob);
    }
}
