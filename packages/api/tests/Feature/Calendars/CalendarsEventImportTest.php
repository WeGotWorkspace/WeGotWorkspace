<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\CalendarEventMapper;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarsEventImportTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_import_multi_vevent_file_creates_all_events(): void
    {
        $response = $this->importIcs($this->multiEventIcs());

        $response->assertCreated()
            ->assertJsonCount(2, 'list')
            ->assertJsonCount(0, 'errors');

        $titles = collect($response->json('list'))->pluck('title')->all();
        $this->assertContains('First imported', $titles);
        $this->assertContains('Second imported', $titles);
    }

    public function test_empty_unreadable_and_vtodo_only_return_400(): void
    {
        $this->importIcs('')->assertStatus(400);
        $this->importIcs('not an ics file')->assertStatus(400);
        $this->importIcs($this->vtodoOnlyIcs())->assertStatus(400)->assertJsonPath('code', 'bad_request');
    }

    public function test_mixed_vevent_and_vtodo_imports_events_only(): void
    {
        $response = $this->importIcs($this->mixedComponentsIcs());

        $response->assertCreated()
            ->assertJsonCount(1, 'list')
            ->assertJsonPath('list.0.title', 'An event');
    }

    public function test_partial_vevent_failure_returns_201_with_errors(): void
    {
        $response = $this->importIcs($this->partialFailureIcs());

        $response->assertCreated()
            ->assertJsonCount(1, 'list')
            ->assertJsonCount(1, 'errors')
            ->assertJsonPath('list.0.title', 'Good event')
            ->assertJsonPath('errors.0.index', 1)
            ->assertJsonPath('errors.0.message', 'Unparseable recurrence rule.');
    }

    public function test_missing_calendar_id_returns_400(): void
    {
        $this->call(
            'POST',
            '/api/v1/calendars/events/import',
            [],
            [],
            [],
            $this->importHeaders(),
            $this->sampleIcs(),
        )->assertStatus(400)->assertJsonPath('code', 'bad_request');
    }

    public function test_unknown_and_foreign_calendar_return_404(): void
    {
        $this->importIcs($this->sampleIcs(), 'missing-cal')->assertNotFound();

        $carolCal = $this->jmapAs('carol', [
            ['Calendar/set', ['accountId' => 'carol', 'create' => ['c' => ['name' => 'Carol only']]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c.id');

        $this->importIcs($this->sampleIcs(), (string) $carolCal)->assertNotFound();
    }

    public function test_read_only_calendar_returns_403(): void
    {
        $calendarId = (string) $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => ['name' => 'Read only']]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c.id');

        CalendarInstance::query()
            ->where('principaluri', 'principals/bob')
            ->where('uri', $calendarId)
            ->update(['access' => 2]);

        $this->importIcs($this->sampleIcs(), $calendarId)
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }

    public function test_recurring_series_round_trips_as_one_series(): void
    {
        $response = $this->importIcs($this->recurringSeriesIcs());

        $response->assertCreated()->assertJsonCount(1, 'list');
        $event = $response->json('list.0');
        $this->assertSame('Weekly standup', $event['title']);
        $this->assertNotEmpty($event['recurrenceRules'] ?? null);
        $this->assertArrayHasKey('recurrenceOverrides', $event);
        $this->assertArrayHasKey('state', $event);
    }

    public function test_destroy_after_import_lists_ids_in_changes(): void
    {
        $imported = $this->importIcs($this->recurringSeriesIcs())->assertCreated()->json('list');
        $eventId = (string) $imported[0]['id'];
        $this->assertNotSame('', $imported[0]['state'] ?? '');

        $preDestroy = (string) $this->calendarSyncToken('default');

        $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'd'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $eventId);

        $changes = $this->app->make(CalendarEventRepository::class)
            ->changes('bob', 'default', $preDestroy);

        $this->assertContains($eventId, $changes['destroyed']);
        $this->assertNull($this->findBobEvent($eventId));
    }

    public function test_valarm_is_kept_as_jscalendar_alerts(): void
    {
        $ics = file_get_contents(dirname(__DIR__, 2).'/fixtures/Calendars/Fastmail/alerts.ics');
        $this->assertIsString($ics);

        $event = $this->importIcs($ics)->assertCreated()->json('list.0');

        $this->assertIsArray($event['alerts'] ?? null);
        $this->assertNotEmpty($event['alerts']);
    }

    public function test_orphan_override_persists_recurrence_id_as_is(): void
    {
        $response = $this->importIcs($this->orphanOverrideIcs())->assertCreated();
        $response->assertJsonCount(1, 'list');

        $event = $response->json('list.0');
        $this->assertSame('Orphan override', $event['title']);
        $this->assertArrayNotHasKey('recurrenceRules', $event);

        $stored = $this->findBobEvent((string) $event['id']);
        $this->assertNotNull($stored);
        $calendardata = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('RECURRENCE-ID', $calendardata);
    }

    public function test_attendees_do_not_write_scheduling_inbox(): void
    {
        $ics = file_get_contents(dirname(__DIR__, 2).'/fixtures/Calendars/Fastmail/participants.ics');
        $this->assertIsString($ics);

        $this->importIcs($ics)->assertCreated()->assertJsonCount(1, 'list');

        $this->assertSame([], $this->schedulingObjectsFor('principals/bob'));
        $this->assertSame([], $this->schedulingObjectsFor('principals/carol'));
    }

    public function test_imported_event_is_search_indexed(): void
    {
        $event = $this->importIcs($this->sampleIcs('Searchable Import'))
            ->assertCreated()
            ->json('list.0');

        $stored = $this->findBobEvent((string) $event['id']);
        $this->assertNotNull($stored);

        $sourceKey = 'bob|default|'.(string) $stored->uri;
        $row = DB::connection('wgw')->table('search_documents')
            ->where('source_type', 'caldav')
            ->where('source_key', $sourceKey)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('calendar', $row->category);
        $this->assertStringContainsString('Searchable Import', (string) $row->title);
    }

    public function test_import_bumps_synctoken_and_changes_lists_created_ids(): void
    {
        $before = (int) $this->calendarSyncToken('default');
        $jmapSince = (string) $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => []], 's'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $imported = $this->importIcs($this->multiEventIcs())->assertCreated()->json('list');
        $ids = collect($imported)->pluck('id')->all();

        $after = (int) $this->calendarSyncToken('default');
        $this->assertGreaterThan($before, $after);

        $changes = $this->app->make(CalendarEventRepository::class)
            ->changes('bob', 'default', (string) $before);

        foreach ($ids as $id) {
            $this->assertContains($id, $changes['created']);
        }

        $jmap = $this->jmap([
            ['CalendarEvent/changes', ['accountId' => 'bob', 'sinceState' => $jmapSince], 'c'],
        ])->assertOk();
        $created = $jmap->json('methodResponses.0.1.created');
        foreach ($ids as $id) {
            $this->assertContains($id, $created);
        }
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->jmapAs('bob', $methodCalls);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        $token = $username === 'bob' ? $this->userBearerToken() : $this->issueBearerTokenFor($username);

        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function importIcs(string $ics, string $calendarId = 'default'): TestResponse
    {
        return $this->call(
            'POST',
            '/api/v1/calendars/events/import?calendarId='.rawurlencode($calendarId),
            [],
            [],
            [],
            $this->importHeaders(),
            $ics,
        );
    }

    /**
     * @return array<string, string>
     */
    private function importHeaders(): array
    {
        return [
            'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
            'CONTENT_TYPE' => 'text/calendar',
            'HTTP_ACCEPT' => 'application/json',
        ];
    }

    private function calendarSyncToken(string $calendarUri): int
    {
        $instance = CalendarInstance::query()
            ->where('principaluri', 'principals/bob')
            ->where('uri', $calendarUri)
            ->first();
        $this->assertNotNull($instance);
        $instance->load('calendar');

        return (int) ($instance->calendar?->synctoken ?? 0);
    }

    private function findBobEvent(string $eventId): ?CalendarObject
    {
        $uri = str_ends_with($eventId, '.ics') ? $eventId : CalendarEventMapper::eventUriFromId($eventId);

        return CalendarObject::query()
            ->where('uri', $uri)
            ->whereHas('calendar.instances', function ($query): void {
                $query->where('principaluri', 'principals/bob');
            })
            ->first();
    }

    /**
     * @return list<array{calendardata: string, uri: string}>
     */
    private function schedulingObjectsFor(string $principalUri): array
    {
        $rows = DB::connection('wgw')->table('schedulingobjects')
            ->where('principaluri', $principalUri)
            ->get(['calendardata', 'uri']);

        $out = [];
        foreach ($rows as $row) {
            $data = $row->calendardata;
            $out[] = [
                'calendardata' => is_string($data) ? $data : (string) $data,
                'uri' => (string) $row->uri,
            ];
        }

        return $out;
    }

    private function multiEventIcs(): string
    {
        return <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:import-1
DTSTART:20260401T100000Z
DTEND:20260401T110000Z
SUMMARY:First imported
END:VEVENT
BEGIN:VEVENT
UID:import-2
DTSTART:20260402T100000Z
DTEND:20260402T110000Z
SUMMARY:Second imported
END:VEVENT
END:VCALENDAR
ICS;
    }

    private function vtodoOnlyIcs(): string
    {
        return <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:todo-only
SUMMARY:Only a task
END:VTODO
END:VCALENDAR
ICS;
    }

    private function mixedComponentsIcs(): string
    {
        return <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:todo-1
SUMMARY:A task
END:VTODO
BEGIN:VJOURNAL
UID:journal-1
SUMMARY:A journal
END:VJOURNAL
BEGIN:VEVENT
UID:event-1
DTSTART:20260501T090000Z
DTEND:20260501T100000Z
SUMMARY:An event
END:VEVENT
END:VCALENDAR
ICS;
    }

    private function partialFailureIcs(): string
    {
        return <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:good-1
DTSTART:20260601T090000Z
DTEND:20260601T100000Z
SUMMARY:Good event
END:VEVENT
BEGIN:VEVENT
UID:bad-1
DTSTART:20260602T090000Z
DTEND:20260602T100000Z
RRULE:FREQ=NOTAFREQ
SUMMARY:Broken recurrence
END:VEVENT
END:VCALENDAR
ICS;
    }

    private function recurringSeriesIcs(): string
    {
        return <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:series-import-1
DTSTART:20260105T100000Z
DTEND:20260105T110000Z
RRULE:FREQ=WEEKLY
SUMMARY:Weekly standup
END:VEVENT
BEGIN:VEVENT
UID:series-import-1
RECURRENCE-ID:20260112T100000Z
DTSTART:20260112T120000Z
DTEND:20260112T130000Z
SUMMARY:Weekly standup moved
END:VEVENT
END:VCALENDAR
ICS;
    }

    private function orphanOverrideIcs(): string
    {
        return <<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:orphan-import-1
RECURRENCE-ID:20260108T100000Z
DTSTART:20260108T120000Z
DTEND:20260108T130000Z
SUMMARY:Orphan override
END:VEVENT
END:VCALENDAR
ICS;
    }
}
