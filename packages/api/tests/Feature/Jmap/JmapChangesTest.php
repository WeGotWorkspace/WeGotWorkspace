<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Account-wide CalendarEvent/changes fan-out and Calendar/changes (chunk D,
 * spec §4): one named test per fan-out branch (unchanged / changed /
 * newly-visible / removed calendar), the malformed-token case, and the
 * single-calendar-account round-trip that is the mismatch-13 regression.
 */
final class JmapChangesTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function currentEventState(): string
    {
        return (string) $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => []], 's'],
        ])->assertOk()->json('methodResponses.0.1.state');
    }

    /**
     * @return array<string, mixed>
     */
    private function eventChanges(string $sinceState): array
    {
        return $this->jmap([
            ['CalendarEvent/changes', ['accountId' => 'bob', 'sinceState' => $sinceState], 'c'],
        ])->assertOk()->json('methodResponses.0.1');
    }

    /**
     * @return array<string, mixed>
     */
    private function calendarChanges(string $sinceState): array
    {
        return $this->jmap([
            ['Calendar/changes', ['accountId' => 'bob', 'sinceState' => $sinceState], 'c'],
        ])->assertOk()->json('methodResponses.0.1');
    }

    private function createCalendarViaJmap(string $name): string
    {
        return (string) $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => ['name' => $name]]], 'c'],
        ])->assertOk()->json('methodResponses.0.1.created.c.id');
    }

    public function test_event_changes_unchanged_calendar_reports_empty_lists(): void
    {
        $this->seedEventViaPdo('bob', 'steady.ics', $this->sampleIcs('Steady'));
        $state = $this->currentEventState();

        $changes = $this->eventChanges($state);

        $this->assertSame($state, $changes['oldState']);
        $this->assertSame($state, $changes['newState']);
        $this->assertFalse($changes['hasMoreChanges']);
        $this->assertSame([], $changes['created']);
        $this->assertSame([], $changes['updated']);
        $this->assertSame([], $changes['destroyed']);
    }

    public function test_event_changes_changed_calendar_merges_the_per_calendar_delta(): void
    {
        $state = $this->currentEventState();

        $eventId = (string) $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => $this->sampleCalendarEventPayload()]], 'c'],
        ])->assertOk()->json('methodResponses.0.1.created.d.id');

        $afterCreate = $this->eventChanges($state);
        $this->assertContains($eventId, $afterCreate['created']);
        $state = (string) $afterCreate['newState'];

        $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => ['title' => 'Renamed']]], 'u'],
        ])->assertOk();

        $afterUpdate = $this->eventChanges($state);
        $this->assertContains($eventId, $afterUpdate['updated']);
        $this->assertNotContains($eventId, $afterUpdate['created']);
        $state = (string) $afterUpdate['newState'];

        $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'd'],
        ])->assertOk();

        $afterDestroy = $this->eventChanges($state);
        $this->assertContains($eventId, $afterDestroy['destroyed']);
        $this->assertNotContains($eventId, $afterDestroy['updated']);
    }

    public function test_event_changes_newly_visible_calendar_reports_all_its_events_created(): void
    {
        $this->seedEventViaPdo('bob', 'preexisting.ics', $this->sampleIcs('Preexisting'));
        $state = $this->currentEventState();

        $calendarId = $this->createCalendarViaJmap('Fresh Calendar');
        $eventId = $this->seedEventViaPdo('bob', 'fresh.ics', $this->sampleIcs('Fresh'), $calendarId);

        $changes = $this->eventChanges($state);

        $this->assertContains($eventId, $changes['created']);
        // The untouched default calendar's events are not falsely reported.
        $this->assertNotContains('preexisting', $changes['created']);
        $this->assertSame([], $changes['destroyed']);
        $this->assertArrayHasKey($calendarId, (array) JmapAccountStateCodec::decompose($changes['newState']));
    }

    public function test_event_changes_removed_calendar_reports_recorded_ids_destroyed(): void
    {
        $calendarId = $this->createCalendarViaJmap('Doomed Calendar');
        $eventId = $this->seedEventViaPdo('bob', 'doomed.ics', $this->sampleIcs('Doomed'), $calendarId);

        // Surface the event over JMAP so a state row records it for the client.
        $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'g'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.list.0.id', $eventId);

        $state = $this->currentEventState();

        $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => [$calendarId], 'onDestroyRemoveEvents' => true], 'd'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $calendarId);

        $changes = $this->eventChanges($state);

        $this->assertContains($eventId, $changes['destroyed']);
        $this->assertSame([], $changes['created']);
        $this->assertArrayNotHasKey($calendarId, (array) JmapAccountStateCodec::decompose($changes['newState']));
    }

    public function test_event_changes_with_malformed_since_state_cannot_calculate_changes(): void
    {
        foreach (['garbage', '17', '2:default:1'] as $sinceState) {
            $this->jmap([
                ['CalendarEvent/changes', ['accountId' => 'bob', 'sinceState' => $sinceState], 'c'],
            ])->assertOk()
                ->assertJsonPath('methodResponses.0.0', 'error')
                ->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
        }
    }

    public function test_single_calendar_account_state_round_trips_into_changes(): void
    {
        // Mismatch-13 regression: bob owns exactly one calendar, so the old
        // composeCalendarState() would emit a bare undecomposable token here.
        $state = $this->currentEventState();
        $this->assertStringStartsWith('1:default:', $state);

        $eventId = $this->seedEventViaPdo('bob', 'single.ics', $this->sampleIcs('Single'));

        $changes = $this->eventChanges($state);
        $this->assertContains($eventId, $changes['created']);

        // And the returned newState is itself decomposable for the next sync.
        $next = $this->eventChanges((string) $changes['newState']);
        $this->assertSame([], $next['created']);
    }

    public function test_calendar_changes_reports_created_and_destroyed_calendars(): void
    {
        $state = (string) $this->calendarChanges('0:')['newState'];

        $calendarId = $this->createCalendarViaJmap('Lifecycle');
        $afterCreate = $this->calendarChanges($state);
        $this->assertContains($calendarId, $afterCreate['created']);
        $this->assertFalse($afterCreate['hasMoreChanges']);
        $state = (string) $afterCreate['newState'];

        $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => [$calendarId]], 'd'],
        ])->assertOk();
        $afterDestroy = $this->calendarChanges($state);
        $this->assertContains($calendarId, $afterDestroy['destroyed']);
        $this->assertNotContains($calendarId, $afterDestroy['created']);
    }

    public function test_calendar_changes_initial_sync_from_zero_reports_all_calendars_created(): void
    {
        $changes = $this->calendarChanges('0:');

        $this->assertContains('default', $changes['created']);
        $this->assertSame('0:', $changes['oldState']);
    }

    public function test_calendar_changes_event_activity_over_reports_the_calendar_as_updated(): void
    {
        $state = (string) $this->calendarChanges('0:')['newState'];

        $this->seedEventViaPdo('bob', 'activity.ics', $this->sampleIcs('Activity'));

        // Sabre bumps the calendar synctoken on event changes, so the
        // calendar surfaces as updated — over-reporting, documented caveat.
        $changes = $this->calendarChanges($state);
        $this->assertContains('default', $changes['updated']);
    }

    public function test_calendar_changes_reports_pure_metadata_updates(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'metadata-bystander.ics', $this->sampleIcs('Bystander'));
        $state = (string) $this->calendarChanges('0:')['newState'];
        $eventState = $this->currentEventState();

        // Rename through the same repository path REST PATCH uses.
        $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'update' => ['default' => ['name' => 'Renamed Calendar']]], 'u'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.default', null);

        // Empirically pinned (spec review amendment 3 resolved favorably):
        // Sabre's updateCalendar records a change-log entry and bumps the
        // synctoken, so a pure rename IS reported as updated.
        $changes = $this->calendarChanges($state);
        $this->assertContains('default', $changes['updated']);

        // The rename's change-log entry carries an empty object uri; the
        // event-level fan-out must not leak phantom event ids from it.
        $eventChanges = $this->eventChanges($eventState);
        $this->assertNotContains('', $eventChanges['created']);
        $this->assertNotContains('', $eventChanges['updated']);
        $this->assertNotContains('', $eventChanges['destroyed']);
        $this->assertNotContains($eventId, $eventChanges['updated']);
    }

    public function test_event_changes_reports_caldav_backend_mutations(): void
    {
        $state = $this->currentEventState();
        $eventId = $this->seedEventViaPdo('bob', 'caldav-origin.ics', $this->sampleIcs('CalDAV Origin'));

        $afterCreate = $this->eventChanges($state);
        $this->assertContains($eventId, $afterCreate['created']);
        $state = (string) $afterCreate['newState'];

        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        $calendarId = $this->resolveCalendarBackendId('bob', 'default');
        $backend->updateCalendarObject($calendarId, 'caldav-origin.ics', $this->sampleIcs('CalDAV Renamed'));

        $afterUpdate = $this->eventChanges($state);
        $this->assertContains($eventId, $afterUpdate['updated']);
        $state = (string) $afterUpdate['newState'];

        $backend->deleteCalendarObject($calendarId, 'caldav-origin.ics');

        $afterDelete = $this->eventChanges($state);
        $this->assertContains($eventId, $afterDelete['destroyed']);
    }

    public function test_event_changes_multi_vevent_object_emits_composite_ids(): void
    {
        $state = $this->currentEventState();
        $this->seedEventViaPdo('bob', 'multi-sync.ics', $this->multiVeventIcs());

        $created = $this->eventChanges($state)['created'];
        $this->assertContains('multi-sync#uid-alpha', $created);
        $this->assertContains('multi-sync#uid-beta', $created);
        $this->assertNotContains('multi-sync', $created);
    }

    public function test_event_changes_destroy_expands_previously_seen_composite_ids(): void
    {
        $this->seedEventViaPdo('bob', 'multi-destroy.ics', $this->multiVeventIcs());
        $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => null], 'g'],
        ])->assertOk();

        $state = $this->currentEventState();
        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        $backend->deleteCalendarObject($this->resolveCalendarBackendId('bob', 'default'), 'multi-destroy.ics');

        $destroyed = $this->eventChanges($state)['destroyed'];
        $this->assertContains('multi-destroy', $destroyed);
        $this->assertContains('multi-destroy#uid-alpha', $destroyed);
        $this->assertContains('multi-destroy#uid-beta', $destroyed);
    }

    public function test_event_changes_removed_sub_vevent_id_goes_to_destroyed(): void
    {
        $this->seedEventViaPdo('bob', 'multi-shrink.ics', $this->multiVeventIcs());
        $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => null], 'g'],
        ])->assertOk();

        $state = $this->currentEventState();
        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        $backend->updateCalendarObject(
            $this->resolveCalendarBackendId('bob', 'default'),
            'multi-shrink.ics',
            $this->sampleIcs('Alpha Only', 'uid-alpha'),
        );

        $changes = $this->eventChanges($state);
        $this->assertContains('multi-shrink', $changes['updated']);
        $this->assertContains('multi-shrink#uid-alpha', $changes['destroyed']);
        $this->assertContains('multi-shrink#uid-beta', $changes['destroyed']);
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
}
