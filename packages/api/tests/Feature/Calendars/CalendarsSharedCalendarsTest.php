<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Membership group VEVENT calendars under principals/groups/{slug}.
 * REST twins were lifted onto Calendar/* and CalendarEvent/* .
 */
final class CalendarsSharedCalendarsTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $team = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Team');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_list_includes_personal_and_group_calendars(): void
    {
        $args = $this->jmapAs('bob', [
            ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $calendars = collect($args['list']);

        $personal = $calendars->firstWhere('id', 'default');
        $this->assertIsArray($personal);
        $this->assertSame('personal', $personal['scope']);
        $this->assertNull($personal['groupSlug']);

        $groupCalendar = $calendars->firstWhere('id', CalendarCollectionUris::groupCalendarApiId(self::TEAM));
        $this->assertIsArray($groupCalendar);
        $this->assertSame('group', $groupCalendar['scope']);
        $this->assertSame(self::TEAM, $groupCalendar['groupSlug']);
        $this->assertSame('Team', $groupCalendar['name']);
        $this->assertSame(CalendarColorPalette::forUri(self::TEAM), $groupCalendar['color']);
        $this->assertFalse($groupCalendar['myRights']['mayDelete']);
    }

    public function test_non_member_does_not_see_group_calendar(): void
    {
        $args = $this->jmapAs('carol', [
            ['Calendar/get', ['accountId' => 'carol', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $ids = array_column($args['list'], 'id');
        $this->assertNotContains(CalendarCollectionUris::groupCalendarApiId(self::TEAM), $ids);
    }

    public function test_show_group_calendar(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);
        $args = $this->jmapAs('bob', [
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame($calendarId, $args['list'][0]['id']);
        $this->assertSame('group', $args['list'][0]['scope']);
        $this->assertSame(self::TEAM, $args['list'][0]['groupSlug']);
    }

    public function test_create_group_scoped_calendar(): void
    {
        $response = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['new-cal' => [
                'name' => 'Roadmap',
                'color' => '#22c55e',
                'groupSlug' => self::TEAM,
                'id' => 'roadmap',
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => ['roadmap']], 'c1'],
        ])->assertOk();

        $created = $response->json('methodResponses.0.1.created.new-cal');
        $this->assertSame('roadmap', $created['id']);
        $this->assertSame('Roadmap', $created['name']);
        $this->assertSame('#22c55e', $created['color']);
        $this->assertSame('group', $created['scope']);
        $this->assertSame(self::TEAM, $created['groupSlug']);

        $this->assertSame('group', $response->json('methodResponses.1.1.list.0.scope'));
        $this->assertSame(self::TEAM, $response->json('methodResponses.1.1.list.0.groupSlug'));
    }

    public function test_create_into_group_requires_membership(): void
    {
        $args = $this->jmapAs('carol', [
            ['Calendar/set', ['accountId' => 'carol', 'create' => ['secret' => [
                'name' => 'Secret',
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([], $args['created']);
        $this->assertSame('forbidden', $args['notCreated']['secret']['type']);
    }

    public function test_member_can_create_event_in_group_calendar(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);
        $eventId = (string) $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['e' => array_merge(
                $this->sampleCalendarEventPayload($calendarId),
                ['title' => 'Team standup'],
            )]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.e.id');
        $this->assertNotSame('', $eventId);

        $event = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertSame('Team standup', $event['title']);
        $this->assertTrue($event['calendarIds'][$calendarId]);
    }

    public function test_group_member_can_update_and_delete_another_members_event(): void
    {
        $carol = Principal::forUsername('carol');
        $this->assertNotNull($carol);
        $team = Principal::query()->where('uri', 'principals/groups/'.self::TEAM)->first();
        $this->assertNotNull($team);
        $this->addPrincipalToGroup($team, $carol);

        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);
        $eventId = (string) $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['e' => array_merge(
                $this->sampleCalendarEventPayload($calendarId),
                ['title' => 'Bob wrote this'],
            )]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.e.id');

        $updated = $this->jmapAs('carol', [
            ['CalendarEvent/set', ['accountId' => 'carol', 'update' => [$eventId => [
                'title' => 'Carol edited Bob\'s event',
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertArrayHasKey($eventId, $updated['updated']);
        $this->assertArrayNotHasKey($eventId, $updated['notUpdated']);

        $event = $this->jmapAs('carol', [
            ['CalendarEvent/get', ['accountId' => 'carol', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('Carol edited Bob\'s event', $event['title']);

        $destroyed = $this->jmapAs('carol', [
            ['CalendarEvent/set', ['accountId' => 'carol', 'destroy' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$eventId], $destroyed['destroyed']);
    }

    public function test_jmap_calendar_set_updates_group_calendar_name_and_color(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $response = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => ['name' => 'Squad', 'color' => '#22c55e']]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.'.$calendarId));
        $this->assertNull($response->json('methodResponses.0.1.updated.'.$calendarId));
        $this->assertSame('Squad', $response->json('methodResponses.1.1.list.0.name'));
        $this->assertSame('#22c55e', $response->json('methodResponses.1.1.list.0.color'));
        $this->assertSame($calendarId, $response->json('methodResponses.1.1.list.0.id'));
    }

    public function test_patch_group_calendar_updates_name_and_color(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $response = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'name' => 'Team planning',
                'color' => '#ec4899',
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();

        $calendar = $response->json('methodResponses.1.1.list.0');
        $this->assertSame($calendarId, $calendar['id']);
        $this->assertSame('Team planning', $calendar['name']);
        $this->assertSame('#ec4899', $calendar['color']);
        $this->assertSame('group', $calendar['scope']);
        $this->assertSame(self::TEAM, $calendar['groupSlug']);
        $this->assertTrue($calendar['myRights']['mayWriteAll']);
        $this->assertFalse($calendar['myRights']['mayDelete']);
    }

    public function test_non_member_cannot_patch_group_calendar(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $args = $this->jmapAs('carol', [
            ['Calendar/set', ['accountId' => 'carol', 'update' => [$calendarId => ['name' => 'Hijacked']]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('notFound', $args['notUpdated'][$calendarId]['type']);
    }

    public function test_delete_provisioned_group_calendar_is_forbidden(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $args = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([], $args['destroyed']);
        $this->assertSame('forbidden', $args['notDestroyed'][$calendarId]['type']);
    }

    public function test_patch_extra_group_calendar_updates_name_and_color(): void
    {
        $create = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['new-cal' => [
                'name' => 'Roadmap',
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.new-cal');
        $calendarId = (string) $create['id'];

        $response = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'name' => 'Roadmap 2026',
                'color' => '#0ea5e9',
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();

        $calendar = $response->json('methodResponses.1.1.list.0');
        $this->assertSame($calendarId, $calendar['id']);
        $this->assertSame('Roadmap 2026', $calendar['name']);
        $this->assertSame('#0ea5e9', $calendar['color']);
        $this->assertSame('group', $calendar['scope']);
        $this->assertSame(self::TEAM, $calendar['groupSlug']);
    }
}
