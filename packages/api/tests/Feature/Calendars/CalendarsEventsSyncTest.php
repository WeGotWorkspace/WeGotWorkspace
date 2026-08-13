<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarsEventsSyncTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use OptimisticConcurrencyTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_event_changes_initial_sync_lists_all_current_ids_in_created(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'initial-sync.ics', $this->sampleIcs('Initial Sync'));

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default')
            ->assertOk();

        $response->assertJsonPath('oldState', '0');
        $response->assertJsonPath('hasMoreChanges', false);
        $this->assertContains($eventId, $response->json('created'));
        $this->assertNotSame('', (string) $response->json('newState'));
    }

    public function test_event_changes_max_changes_is_accepted_but_never_truncates(): void
    {
        $state = $this->currentEventSyncState();

        $firstId = $this->seedEventViaPdo('bob', 'max-one.ics', $this->sampleIcs('Max One'));
        $secondId = $this->seedEventViaPdo('bob', 'max-two.ics', $this->sampleIcs('Max Two'));

        // maxChanges is accepted (RFC 8620 §5.2) but the full delta is returned:
        // Sabre's changes log cannot produce a safe intermediate sync token.
        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state.'&maxChanges=1')
            ->assertOk()
            ->assertJsonPath('hasMoreChanges', false);

        $created = $response->json('created');
        $this->assertContains($firstId, $created);
        $this->assertContains($secondId, $created);
    }

    public function test_event_changes_invalid_max_changes_returns_400(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&maxChanges=abc')
            ->assertBadRequest()
            ->assertJsonPath('code', 'bad_request');

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&maxChanges=0')
            ->assertBadRequest()
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_event_changes_empty_since_is_initial_sync_with_old_state_zero(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'empty-since.ics', $this->sampleIcs('Empty Since'));

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since=')
            ->assertOk();

        $response->assertJsonPath('oldState', '0');
        $this->assertContains($eventId, $response->json('created'));
        $this->assertNotSame('', (string) $response->json('newState'));
    }

    public function test_event_changes_reports_rest_create_update_delete(): void
    {
        $state = $this->currentEventSyncState();

        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events', $this->sampleCalendarEventPayload())
            ->assertCreated();
        $eventId = (string) $create->json('id');

        $afterCreate = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $afterCreate->assertJsonPath('oldState', $state);
        $this->assertContains($eventId, $afterCreate->json('created'));
        $state = (string) $afterCreate->json('newState');

        $eventUrl = '/api/v1/calendars/events/'.$eventId;
        $this->withBearer($this->userBearerToken())
            ->patchJson($eventUrl, ['title' => 'Renamed Event'], $this->withIfMatch($this->fetchEtagFromGet($eventUrl)))
            ->assertOk();

        $afterUpdate = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $this->assertContains($eventId, $afterUpdate->json('updated'));
        $this->assertNotContains($eventId, $afterUpdate->json('created'));
        $state = (string) $afterUpdate->json('newState');

        $this->withBearer($this->userBearerToken())
            ->deleteJson($eventUrl, [], $this->withIfMatch($this->fetchEtagFromGet($eventUrl)))
            ->assertOk();

        $afterDelete = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $this->assertContains($eventId, $afterDelete->json('destroyed'));
    }

    public function test_event_changes_reports_caldav_backend_mutations(): void
    {
        $state = $this->currentEventSyncState();

        $eventId = $this->seedEventViaPdo('bob', 'caldav-origin.ics', $this->sampleIcs('CalDAV Origin'));

        $afterCreate = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $this->assertContains($eventId, $afterCreate->json('created'));
        $state = (string) $afterCreate->json('newState');

        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        $calendarId = $this->resolveBobDefaultCalendarBackendId();
        $backend->updateCalendarObject($calendarId, 'caldav-origin.ics', $this->sampleIcs('CalDAV Renamed'));

        $afterUpdate = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $this->assertContains($eventId, $afterUpdate->json('updated'));
        $state = (string) $afterUpdate->json('newState');

        $backend->deleteCalendarObject($calendarId, 'caldav-origin.ics');

        $afterDelete = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $this->assertContains($eventId, $afterDelete->json('destroyed'));
    }

    public function test_event_changes_multi_vevent_object_emits_composite_ids(): void
    {
        $state = $this->currentEventSyncState();

        $this->seedEventViaPdo('bob', 'multi-sync.ics', $this->multiVeventIcs());

        $afterCreate = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $created = $afterCreate->json('created');
        $this->assertContains('multi-sync#uid-alpha', $created);
        $this->assertContains('multi-sync#uid-beta', $created);
        $this->assertNotContains('multi-sync', $created);
        $state = (string) $afterCreate->json('newState');

        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        $backend->updateCalendarObject(
            $this->resolveBobDefaultCalendarBackendId(),
            'multi-sync.ics',
            $this->multiVeventIcs('Alpha Renamed'),
        );

        $afterUpdate = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $updated = $afterUpdate->json('updated');
        $this->assertContains('multi-sync#uid-alpha', $updated);
        $this->assertContains('multi-sync#uid-beta', $updated);
    }

    public function test_event_changes_destroy_expands_previously_seen_composite_ids(): void
    {
        $this->seedEventViaPdo('bob', 'multi-destroy.ics', $this->multiVeventIcs());

        // Surface composite ids over REST so state rows exist for destroy expansion.
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events?calendarId=default')
            ->assertOk();

        $state = $this->currentEventSyncState();

        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        $backend->deleteCalendarObject($this->resolveBobDefaultCalendarBackendId(), 'multi-destroy.ics');

        $afterDelete = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $destroyed = $afterDelete->json('destroyed');
        $this->assertContains('multi-destroy', $destroyed);
        $this->assertContains('multi-destroy#uid-alpha', $destroyed);
        $this->assertContains('multi-destroy#uid-beta', $destroyed);
    }

    public function test_event_changes_removed_sub_vevent_id_goes_to_destroyed(): void
    {
        $this->seedEventViaPdo('bob', 'multi-shrink.ics', $this->multiVeventIcs());

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events?calendarId=default')
            ->assertOk();

        $state = $this->currentEventSyncState();

        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        $backend->updateCalendarObject(
            $this->resolveBobDefaultCalendarBackendId(),
            'multi-shrink.ics',
            $this->sampleIcs('Alpha Only', 'uid-alpha'),
        );

        $changes = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();

        // Object is now single-VEVENT: plain id in updated, both stale ids destroyed.
        $this->assertContains('multi-shrink', $changes->json('updated'));
        $destroyed = $changes->json('destroyed');
        $this->assertContains('multi-shrink#uid-alpha', $destroyed);
        $this->assertContains('multi-shrink#uid-beta', $destroyed);
    }

    public function test_event_changes_invalid_token_returns_400(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since=not-a-token')
            ->assertBadRequest()
            ->assertJsonPath('code', 'cannotCalculateChanges');

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since=999999999')
            ->assertBadRequest()
            ->assertJsonPath('code', 'cannotCalculateChanges');
    }

    public function test_event_changes_unknown_calendar_returns_404(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=nope')
            ->assertNotFound();
    }

    public function test_event_changes_are_isolated_per_calendar_and_user(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/calendars', ['name' => 'Second', 'id' => 'second'])
            ->assertCreated();

        $state = $this->currentEventSyncState();
        $secondState = $this->currentEventSyncState('second');

        $otherCalendarEventId = $this->seedEventViaPdo('bob', 'second-cal.ics', $this->sampleIcs('Second Cal'), 'second');
        $carolEventId = $this->seedEventViaPdo('carol', 'carol-sync.ics', $this->sampleIcs('Carol Sync'));

        $defaultChanges = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();
        $this->assertNotContains($otherCalendarEventId, $defaultChanges->json('created'));
        $this->assertNotContains($carolEventId, $defaultChanges->json('created'));

        $secondChanges = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=second&since='.$secondState)
            ->assertOk();
        $this->assertContains($otherCalendarEventId, $secondChanges->json('created'));
    }

    public function test_event_changes_ignore_calendar_property_change_entries(): void
    {
        $state = $this->currentEventSyncState();

        // Sabre's updateCalendar logs a change entry with an empty object
        // uri; it must not surface as a phantom event id in any list.
        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/calendars/calendars/default', ['name' => 'Renamed Calendar'])
            ->assertOk();

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default&since='.$state)
            ->assertOk();

        $this->assertNotContains('', $response->json('created'));
        $this->assertNotContains('', $response->json('updated'));
        $this->assertNotContains('', $response->json('destroyed'));
    }

    private function currentEventSyncState(string $calendarId = 'default'): string
    {
        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId='.$calendarId)
            ->assertOk();

        $state = (string) $response->json('newState');
        $this->assertNotSame('', $state);

        return $state;
    }

    private function multiVeventIcs(string $alphaSummary = 'Alpha Event'): string
    {
        $start = gmdate('Ymd\THis\Z', strtotime('+1 day 09:00 UTC'));
        $end = gmdate('Ymd\THis\Z', strtotime('+1 day 10:00 UTC'));
        $startB = gmdate('Ymd\THis\Z', strtotime('+2 days 09:00 UTC'));
        $endB = gmdate('Ymd\THis\Z', strtotime('+2 days 10:00 UTC'));

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            ."BEGIN:VEVENT\r\nUID:uid-alpha\r\nSUMMARY:{$alphaSummary}\r\nDTSTART:{$start}\r\nDTEND:{$end}\r\nEND:VEVENT\r\n"
            ."BEGIN:VEVENT\r\nUID:uid-beta\r\nSUMMARY:Beta Event\r\nDTSTART:{$startB}\r\nDTEND:{$endB}\r\nEND:VEVENT\r\n"
            ."END:VCALENDAR\r\n";
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function resolveBobDefaultCalendarBackendId(): array
    {
        return $this->resolveCalendarBackendId('bob', 'default');
    }
}
