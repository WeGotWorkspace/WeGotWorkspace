<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CalendarObject;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Calendars\DefaultCalendarColorMigrator;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
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
        $this->assertSame('#336699', $createdCalendar['color']);
        $this->assertArrayHasKey('mayWriteAll', $createdCalendar['myRights']);
        $calendarId = (string) $createdCalendar['id'];

        // oldState/newState are envelope-decomposable and differ (a calendar was added).
        $this->assertIsArray(JmapAccountStateCodec::decompose($create['oldState']));
        $newTokens = JmapAccountStateCodec::decompose($create['newState']);
        $this->assertArrayHasKey($calendarId, $newTokens);

        $update = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => ['name' => 'Projects 2026', 'color' => '#ec4899']]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();
        $this->assertNull($update->json('methodResponses.0.1.updated.'.$calendarId));
        $this->assertSame('Projects 2026', $update->json('methodResponses.1.1.list.0.name'));
        $this->assertSame('#ec4899', $update->json('methodResponses.1.1.list.0.color'));

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

    public function test_provisioned_personal_calendars_have_distinct_colors(): void
    {
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        app(DefaultCalendarColorMigrator::class)->migrateAll();

        $list = $this->jmap([
            ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $calendars = collect($list);

        $colors = [];
        foreach ([
            CalendarCollectionUris::EVENT_DEFAULT,
            CalendarCollectionUris::EVENT_HOME,
            CalendarCollectionUris::EVENT_WORK,
        ] as $id) {
            $calendar = $calendars->firstWhere('id', $id);
            $this->assertIsArray($calendar);
            $this->assertSame(CalendarColorPalette::forUri($id), $calendar['color']);
            $colors[] = strtolower((string) $calendar['color']);
        }

        $this->assertCount(3, array_unique($colors));
    }

    public function test_calendar_set_create_accepts_description_and_ignores_share_with(): void
    {
        $create = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => [
                'name' => 'Work calendar',
                'id' => 'work',
                'description' => 'Work-only events',
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c');
        $this->assertSame('work', $create['id']);
        $this->assertSame('Work-only events', $create['description']);
        $this->assertTrue($create['myRights']['mayDelete']);

        $updated = $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['alice' => ['mayRead' => true]],
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => ['default']], 'c1'],
        ])->assertOk();
        $this->assertNull($updated->json('methodResponses.0.1.notUpdated.default'));
        $this->assertNull($updated->json('methodResponses.1.1.list.0.shareWith'));
    }

    public function test_calendar_event_query_time_range_title_sort_and_recurrence(): void
    {
        $inWindow = $this->seedEventViaPdo('bob', 'in-window.ics', $this->sampleIcs(
            'Quarterly Planning',
            null,
            '20260901T100000Z',
            '20260901T110000Z',
        ));
        $outOfWindow = $this->seedEventViaPdo('bob', 'out-window.ics', $this->sampleIcs(
            'Daily Standup',
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
        $recurringId = $this->seedEventViaPdo('bob', 'weekly.ics', $this->recurringIcs(
            'Weekly Standup',
            '20260106T090000Z',
            '20260106T093000Z',
        ));

        $range = $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => [
                'inCalendars' => ['default'],
                'after' => '2026-09-01T00:00:00Z',
                'before' => '2026-09-08T00:00:00Z',
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $this->assertContains($inWindow, $range);
        $this->assertContains($straddling, $range);
        $this->assertNotContains($outOfWindow, $range);
        $this->assertContains($recurringId, $range);

        $missedRecurrence = $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => [
                'inCalendars' => ['default'],
                'after' => '2026-09-02T00:00:00Z',
                'before' => '2026-09-04T00:00:00Z',
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $this->assertNotContains($recurringId, $missedRecurrence);

        $title = $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => [
                'inCalendars' => ['default'],
                'title' => 'quarterly',
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $this->assertContains($inWindow, $title);
        $this->assertNotContains($outOfWindow, $title);

        $first = $this->seedEventViaPdo('bob', 'sorted-a.ics', $this->sampleIcs('Sorted A', null, '20260901T090000Z', '20260901T100000Z'));
        $second = $this->seedEventViaPdo('bob', 'sorted-b.ics', $this->sampleIcs('Sorted B', null, '20260902T090000Z', '20260902T100000Z'));
        $third = $this->seedEventViaPdo('bob', 'sorted-c.ics', $this->sampleIcs('Sorted C', null, '20260903T090000Z', '20260903T100000Z'));
        $window = [
            'inCalendars' => ['default'],
            'after' => '2026-09-01T00:00:00Z',
            'before' => '2026-09-05T00:00:00Z',
        ];
        $ascending = $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => $window, 'sort' => [['property' => 'start', 'isAscending' => true]]], 'c0'],
        ])->assertOk();
        $this->assertSame([$first, $inWindow, $second, $third], array_values(array_intersect(
            $ascending->json('methodResponses.0.1.ids'),
            [$first, $inWindow, $second, $third],
        )));

        $paged = $this->jmap([
            ['CalendarEvent/query', [
                'accountId' => 'bob',
                'filter' => [
                    'inCalendars' => ['default'],
                    'after' => '2026-09-01T00:00:00Z',
                    'before' => '2026-09-04T00:00:00Z',
                    'title' => 'Sorted',
                ],
                'sort' => [['property' => 'start', 'isAscending' => false]],
                'position' => 1,
                'limit' => 1,
            ], 'c0'],
        ])->assertOk();
        $this->assertSame(1, $paged->json('methodResponses.0.1.position'));
        $this->assertSame([$second], $paged->json('methodResponses.0.1.ids'));
    }

    public function test_calendar_event_query_multi_vevent_isolation_and_after_without_before(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            ."BEGIN:VEVENT\r\nUID:uid-in\r\nSUMMARY:Sub In Window\r\nDTSTART:20260902T100000Z\r\nDTEND:20260902T110000Z\r\nEND:VEVENT\r\n"
            ."BEGIN:VEVENT\r\nUID:uid-out\r\nSUMMARY:Sub Out Of Window\r\nDTSTART:20261002T100000Z\r\nDTEND:20261002T110000Z\r\nEND:VEVENT\r\n"
            ."END:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'multi-query.ics', $ics);

        $ids = $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => [
                'inCalendars' => ['default'],
                'after' => '2026-09-01T00:00:00Z',
                'before' => '2026-09-08T00:00:00Z',
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $this->assertContains('multi-query#uid-in', $ids);
        $this->assertNotContains('multi-query#uid-out', $ids);

        $secondCalendarId = (string) $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => ['name' => 'Second']]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c.id');
        $defaultEvent = $this->seedEventViaPdo('bob', 'iso-default.ics', $this->sampleIcs('Iso Default'));
        $secondEvent = $this->seedEventViaPdo('bob', 'iso-second.ics', $this->sampleIcs('Iso Second'), $secondCalendarId);
        $carolEvent = $this->seedEventViaPdo('carol', 'iso-carol.ics', $this->sampleIcs('Iso Carol'));

        $both = $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => [
                'inCalendars' => ['default', $secondCalendarId],
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $this->assertContains($defaultEvent, $both);
        $this->assertContains($secondEvent, $both);
        $this->assertNotContains($carolEvent, $both);

        $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => [
                'inCalendars' => ['default'],
                'after' => '2026-09-01T00:00:00Z',
            ]], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'invalidArguments');
    }

    public function test_calendar_event_get_returns_rrule_overrides_and_composite_ids(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:recur-1\r\nSUMMARY:Weekly Standup\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'weekly-standup.ics', $ics);
        $event = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('Weekly Standup', $event['title']);
        $this->assertSame('weekly', $event['recurrenceRules'][0]['frequency']);
        $this->assertSame([['@type' => 'NDay', 'day' => 'mo']], $event['recurrenceRules'][0]['byDay']);
        $this->assertArrayNotHasKey('instances', $event);

        $overrideIcs = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:series-api\r\nSUMMARY:Weekly Sync\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series-api\r\nRECURRENCE-ID:20260617T090000Z\r\nDTSTART:20260617T140000Z\r\nDTEND:20260617T143000Z\r\nSUMMARY:Weekly Sync (moved)\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $overrideId = $this->seedEventViaPdo('bob', 'weekly-sync.ics', $overrideIcs);
        $override = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$overrideId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('series-api', $override['uid']);
        $this->assertSame('2026-06-17T14:00:00Z', $override['recurrenceOverrides']['2026-06-17T09:00:00Z']['start']);
        $this->assertSame('Weekly Sync (moved)', $override['recurrenceOverrides']['2026-06-17T09:00:00Z']['title']);

        $multi = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:first\r\nSUMMARY:Primary Event\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:second\r\nSUMMARY:Secondary Event\r\nDTSTART:20260611T090000Z\r\nDTEND:20260611T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'multi-event.ics', $multi);
        $list = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $ids = array_column($list, 'id');
        $this->assertContains('multi-event#first', $ids);
        $this->assertContains('multi-event#second', $ids);
    }

    private function recurringIcs(string $summary, string $start, string $end): string
    {
        $uid = 'urn:uuid:recurring-'.md5($summary);

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\n"
            ."DTSTART:{$start}\r\nDTEND:{$end}\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }
}
