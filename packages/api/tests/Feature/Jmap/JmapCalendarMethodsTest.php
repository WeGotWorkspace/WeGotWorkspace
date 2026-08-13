<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CalendarObject;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Calendar/get, Calendar/set, CalendarEvent/get, and CalendarEvent/query
 * behind the /jmap dispatcher (chunk C): GetResponse/SetResponse/QueryResponse
 * shapes per the shipped client's core/types.ts, myRights per spec §6, and
 * the inCalendars injection the adapter's loadRange() relies on.
 */
final class JmapCalendarMethodsTest extends WgwDatabaseTestCase
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

    public function test_calendar_get_returns_the_get_response_shape_with_eight_property_rights(): void
    {
        $response = $this->jmap([
            ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'Calendar/get');
        $args = $response->json('methodResponses.0.1');

        $this->assertSame('bob', $args['accountId']);
        $this->assertIsArray(JmapAccountStateCodec::decompose($args['state']), 'state must be envelope-decomposable');
        $this->assertSame([], $args['notFound']);

        $calendar = collect($args['list'])->firstWhere('id', 'default');
        $this->assertNotNull($calendar);
        $this->assertSame('Calendar', $calendar['name']);

        // spec §6 owner row: everything but mayShare, mayDelete false for 'default'.
        $this->assertSame([
            'mayReadFreeBusy' => true,
            'mayReadItems' => true,
            'mayWriteAll' => true,
            'mayWriteOwn' => true,
            'mayUpdatePrivate' => true,
            'mayRSVP' => true,
            'mayShare' => false,
            'mayDelete' => false,
        ], $calendar['myRights']);
    }

    public function test_calendar_get_with_ids_filters_and_reports_not_found(): void
    {
        $args = $this->jmap([
            ['Calendar/get', ['accountId' => 'bob', 'ids' => ['default', 'missing-calendar']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertCount(1, $args['list']);
        $this->assertSame('default', $args['list'][0]['id']);
        $this->assertSame(['missing-calendar'], $args['notFound']);
    }

    public function test_calendar_get_projects_requested_properties_plus_id(): void
    {
        $args = $this->jmap([
            ['Calendar/get', ['accountId' => 'bob', 'ids' => ['default'], 'properties' => ['name']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame(['id' => 'default', 'name' => 'Calendar'], $args['list'][0]);
    }

    public function test_calendar_set_creates_updates_and_destroys(): void
    {
        $create = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['new-cal' => ['name' => 'Projects', 'color' => '#336699']]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('bob', $create['accountId']);
        $createdCalendar = $create['created']['new-cal'];
        $this->assertSame('Projects', $createdCalendar['name']);
        $this->assertArrayHasKey('mayWriteAll', $createdCalendar['myRights']);
        $calendarId = (string) $createdCalendar['id'];

        // oldState/newState are envelope-decomposable and differ (a calendar was added).
        $this->assertIsArray(JmapAccountStateCodec::decompose($create['oldState']));
        $newTokens = JmapAccountStateCodec::decompose($create['newState']);
        $this->assertArrayHasKey($calendarId, $newTokens);

        $update = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => ['name' => 'Projects 2026']]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();
        $this->assertNull($update->json('methodResponses.0.1.updated.'.$calendarId));
        $this->assertSame('Projects 2026', $update->json('methodResponses.1.1.list.0.name'));

        $destroy = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$calendarId], $destroy['destroyed']);
    }

    public function test_calendar_set_destroy_of_default_calendar_is_forbidden(): void
    {
        $args = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => ['default']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([], $args['destroyed']);
        $this->assertSame('forbidden', $args['notDestroyed']['default']['type']);
    }

    public function test_calendar_set_destroy_with_events_requires_on_destroy_remove_events(): void
    {
        $created = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => ['name' => 'Busy']]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c');
        $calendarId = (string) $created['id'];
        $this->seedEventViaPdo('bob', 'busy-event.ics', $this->sampleIcs('Busy Event'), $calendarId);

        // Without onDestroyRemoveEvents → draft-ietf-jmap-calendars calendarHasEvent.
        $refused = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('calendarHasEvent', $refused['notDestroyed'][$calendarId]['type']);

        $removed = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => [$calendarId], 'onDestroyRemoveEvents' => true], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$calendarId], $removed['destroyed']);
    }

    public function test_calendar_set_with_stale_if_in_state_is_a_state_mismatch_without_mutation(): void
    {
        $response = $this->jmap([
            ['Calendar/set', [
                'accountId' => 'bob',
                'ifInState' => '1:default:999999',
                'create' => ['x' => ['name' => 'Should Not Exist']],
            ], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'error');
        $response->assertJsonPath('methodResponses.0.1.type', 'stateMismatch');
        $names = array_column($response->json('methodResponses.1.1.list'), 'name');
        $this->assertNotContains('Should Not Exist', $names);
    }

    public function test_calendar_event_get_with_ids_null_lists_events_across_all_calendars(): void
    {
        $firstId = $this->seedEventViaPdo('bob', 'first.ics', $this->sampleIcs('First'));
        $created = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => ['name' => 'Second Calendar']]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c');
        $secondCalendarId = (string) $created['id'];
        $secondId = $this->seedEventViaPdo('bob', 'second.ics', $this->sampleIcs('Second'), $secondCalendarId);

        $args = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $ids = array_column($args['list'], 'id');
        $this->assertContains($firstId, $ids);
        $this->assertContains($secondId, $ids);
        $this->assertSame([], $args['notFound']);
        $tokens = JmapAccountStateCodec::decompose($args['state']);
        $this->assertArrayHasKey('default', $tokens);
        $this->assertArrayHasKey($secondCalendarId, $tokens);
    }

    public function test_calendar_event_get_by_ids_returns_records_and_not_found(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'lookup.ics', $this->sampleIcs('Lookup'));

        $args = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId, 'missing-event']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertCount(1, $args['list']);
        $this->assertSame($eventId, $args['list'][0]['id']);
        $this->assertSame('Lookup', $args['list'][0]['title']);
        $this->assertSame(['missing-event'], $args['notFound']);
    }

    public function test_calendar_event_get_projects_properties(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'proj.ics', $this->sampleIcs('Projected'));

        $args = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId], 'properties' => ['title', 'calendarIds']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $record = $args['list'][0];
        ksort($record);
        $this->assertSame(
            ['calendarIds' => ['default' => true], 'id' => $eventId, 'title' => 'Projected'],
            $record,
        );
    }

    public function test_calendar_event_query_injects_in_calendars_when_absent(): void
    {
        // The shipped adapter's loadRange() sends only after/before —
        // never inCalendars (spec §Ground-truth contracts).
        $eventId = $this->seedEventViaPdo('bob', 'ranged.ics', $this->sampleIcs(
            'Ranged',
            start: gmdate('Ymd\THis\Z', strtotime('2030-06-15 10:00 UTC')),
            end: gmdate('Ymd\THis\Z', strtotime('2030-06-15 11:00 UTC')),
        ));

        $args = $this->jmap([
            ['CalendarEvent/query', [
                'accountId' => 'bob',
                'filter' => ['after' => '2030-06-01T00:00:00Z', 'before' => '2030-07-01T00:00:00Z'],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([$eventId], $args['ids']);
        $this->assertSame(0, $args['position']);
        $this->assertSame(1, $args['total']);
        $this->assertFalse($args['canCalculateChanges']);
        $this->assertIsArray(JmapAccountStateCodec::decompose($args['queryState']));
    }

    public function test_calendar_event_query_with_empty_in_calendars_matches_nothing(): void
    {
        $this->seedEventViaPdo('bob', 'unmatched.ics', $this->sampleIcs('Unmatched'));

        $args = $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => ['inCalendars' => []]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([], $args['ids']);
        $this->assertSame(0, $args['total']);
    }

    public function test_query_and_get_batch_via_ids_back_reference_mirrors_the_adapter(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'batched.ics', $this->sampleIcs(
            'Batched',
            start: gmdate('Ymd\THis\Z', strtotime('2031-01-10 09:00 UTC')),
            end: gmdate('Ymd\THis\Z', strtotime('2031-01-10 10:00 UTC')),
        ));

        // Exactly getCalendarEventsInRange(): query + get wired with "#ids",
        // path "/ids" (JmapCalendarsClient.ts:155-168).
        $response = $this->jmap([
            ['CalendarEvent/query', [
                'accountId' => 'bob',
                'filter' => ['after' => '2031-01-01T00:00:00Z', 'before' => '2031-02-01T00:00:00Z'],
            ], 'q'],
            ['CalendarEvent/get', [
                'accountId' => 'bob',
                '#ids' => ['resultOf' => 'q', 'name' => 'CalendarEvent/query', 'path' => '/ids'],
            ], 'g'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'CalendarEvent/query');
        $response->assertJsonPath('methodResponses.1.0', 'CalendarEvent/get');
        $this->assertSame([$eventId], $response->json('methodResponses.0.1.ids'));
        $this->assertSame($eventId, $response->json('methodResponses.1.1.list.0.id'));
        $this->assertSame('Batched', $response->json('methodResponses.1.1.list.0.title'));
    }

    public function test_query_with_unknown_calendar_id_is_invalid_arguments(): void
    {
        $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => ['inCalendars' => ['nope']]], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'invalidArguments');
    }

    public function test_get_with_ids_beyond_max_objects_in_get_is_request_too_large(): void
    {
        $ids = array_map(static fn (int $i): string => "id-{$i}", range(0, JmapCapabilities::MAX_OBJECTS_IN_GET));

        $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => $ids], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'requestTooLarge');
    }

    public function test_event_get_all_beyond_max_objects_in_get_is_request_too_large(): void
    {
        // Seeded straight into calendarobjects: 501 Sabre createCalendarObject
        // round-trips would dominate the suite runtime for no extra coverage.
        [$backendCalendarId] = $this->resolveCalendarBackendId('bob', 'default');
        $rows = [];
        for ($i = 0; $i <= JmapCapabilities::MAX_OBJECTS_IN_GET; $i++) {
            $ics = $this->sampleIcs("Bulk {$i}", uid: "bulk-uid-{$i}");
            $rows[] = [
                'calendardata' => $ics,
                'uri' => sprintf('bulk-%04d.ics', $i),
                'calendarid' => $backendCalendarId,
                'lastmodified' => time(),
                'etag' => md5($ics),
                'size' => strlen($ics),
                'componenttype' => 'VEVENT',
                'uid' => "bulk-uid-{$i}",
            ];
        }
        foreach (array_chunk($rows, 100) as $chunk) {
            CalendarObject::query()->insert($chunk);
        }

        $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'requestTooLarge');
    }

    public function test_set_beyond_max_objects_in_set_is_request_too_large(): void
    {
        $destroy = array_map(static fn (int $i): string => "gone-{$i}", range(0, JmapCapabilities::MAX_OBJECTS_IN_SET));

        $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => $destroy], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'requestTooLarge');
    }
}
