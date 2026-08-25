<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\CalendarSubscription;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Calendar/set groupSlug transfer (Task #628 / Goal #615).
 */
final class CalendarsChangeOwnerTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedDefaultCalendarFor('alice');
        $team = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Team');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $this->addPrincipalToGroup($team, $alice);
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

    public function test_owner_can_move_personal_calendar_to_a_group(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Roadmap', 'roadmap');

        $response = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.'.$calendarId));
        $calendar = $response->json('methodResponses.1.1.list.0');
        $this->assertSame($calendarId, $calendar['id']);
        $this->assertSame('group', $calendar['scope']);
        $this->assertSame(self::TEAM, $calendar['groupSlug']);

        $this->assertTrue(
            CalendarInstance::query()
                ->where('uri', $calendarId)
                ->where('principaluri', 'principals/groups/'.self::TEAM)
                ->exists(),
        );

        $aliceList = $this->jmapAs('alice', [
            ['Calendar/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $this->assertContains($calendarId, array_column($aliceList, 'id'));
    }

    public function test_owner_can_move_group_calendar_to_personal(): void
    {
        $calendarId = $this->createGroupCalendar('bob', 'Roadmap', 'roadmap');

        $response = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'groupSlug' => null,
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.'.$calendarId));
        $calendar = $response->json('methodResponses.1.1.list.0');
        $this->assertSame('personal', $calendar['scope']);
        $this->assertNull($calendar['groupSlug']);

        $aliceIds = array_column($this->jmapAs('alice', [
            ['Calendar/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'id');
        $this->assertNotContains($calendarId, $aliceIds);
    }

    public function test_transfer_keeps_events_and_share_with(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Shared Roadmap', 'shared-roadmap');
        $this->shareCalendar('bob', $calendarId, 'carol', false);
        $eventId = (string) $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['e' => array_merge(
                $this->sampleCalendarEventPayload($calendarId),
                ['title' => 'Kickoff'],
            )]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.e.id');

        $calendarid = (int) CalendarInstance::query()->where('uri', $calendarId)->where('principaluri', 'principals/bob')->value('calendarid');

        $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk();

        $this->assertSame(
            $calendarid,
            (int) CalendarInstance::query()->where('uri', $calendarId)->where('principaluri', 'principals/groups/'.self::TEAM)->value('calendarid'),
        );
        $this->assertSame(1, CalendarObject::query()->where('calendarid', $calendarid)->count());

        $event = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('Kickoff', $event['title']);
        $this->assertTrue($event['calendarIds'][$calendarId]);

        $shareWith = $this->jmapAs('bob', [
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0.shareWith');
        $this->assertIsArray($shareWith['carol']);
        $this->assertTrue($shareWith['carol']['mayReadItems']);

        $carol = $this->calendarNamed('carol', 'Shared Roadmap');
        $this->assertFalse($carol['myRights']['mayShare']);
        $this->assertTrue($carol['myRights']['mayReadItems']);
    }

    public function test_sharee_cannot_change_owner(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Locked Owner', 'locked-owner');
        $this->shareCalendar('bob', $calendarId, 'carol', true);
        $shared = $this->calendarNamed('carol', 'Locked Owner');

        $args = $this->jmapAs('carol', [
            ['Calendar/set', ['accountId' => 'carol', 'update' => [$shared['id'] => [
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('forbidden', $args['notUpdated'][$shared['id']]['type']);
        $this->assertTrue(
            CalendarInstance::query()
                ->where('uri', $calendarId)
                ->where('principaluri', 'principals/bob')
                ->exists(),
        );
    }

    public function test_default_and_provisioned_group_calendars_cannot_change_owner(): void
    {
        $default = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => ['default' => [
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('forbidden', $default['notUpdated']['default']['type']);

        $groupId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);
        $provisioned = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$groupId => [
                'groupSlug' => null,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('forbidden', $provisioned['notUpdated'][$groupId]['type']);
    }

    public function test_subscription_cannot_change_owner(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Holidays', 'holidays');
        CalendarSubscription::query()->create([
            'id' => (string) Str::uuid(),
            'username' => 'bob',
            'calendar_uri' => $calendarId,
            'url' => 'https://feeds.example.test/holidays.ics',
            'name' => 'Holidays',
            'last_fetched_at' => now(),
        ]);

        $args = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('forbidden', $args['notUpdated'][$calendarId]['type']);
    }

    public function test_transfer_to_a_group_requires_membership(): void
    {
        $calendarId = $this->createPersonalCalendar('carol', 'Solo', 'solo');

        $args = $this->jmapAs('carol', [
            ['Calendar/set', ['accountId' => 'carol', 'update' => [$calendarId => [
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('forbidden', $args['notUpdated'][$calendarId]['type']);
    }

    public function test_transfer_rejects_uri_collision_on_the_target_principal(): void
    {
        $this->createGroupCalendar('bob', 'Roadmap', 'roadmap');
        $personalId = $this->createPersonalCalendar('bob', 'Roadmap personal', 'roadmap');

        $args = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$personalId => [
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('invalidProperties', $args['notUpdated'][$personalId]['type']);
    }

    private function createPersonalCalendar(string $username, string $name, string $id): string
    {
        $created = $this->jmapAs($username, [
            ['Calendar/set', ['accountId' => $username, 'create' => ['c' => [
                'name' => $name,
                'id' => $id,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c');

        return (string) $created['id'];
    }

    private function createGroupCalendar(string $username, string $name, string $id): string
    {
        $created = $this->jmapAs($username, [
            ['Calendar/set', ['accountId' => $username, 'create' => ['c' => [
                'name' => $name,
                'id' => $id,
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c');

        return (string) $created['id'];
    }

    private function shareCalendar(string $owner, string $calendarId, string $sharee, bool $write): void
    {
        $rights = $write
            ? ['mayWriteAll' => true]
            : ['mayReadItems' => true];

        $args = $this->jmapAs($owner, [
            ['Calendar/set', ['accountId' => $owner, 'update' => [$calendarId => [
                'shareWith' => [$sharee => $rights],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertNull($args['notUpdated'][$calendarId] ?? null);
    }

    /**
     * @return array<string, mixed>
     */
    private function calendarNamed(string $username, string $name): array
    {
        $list = $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $calendar = collect($list)->first(
            static fn (array $row): bool => $row['name'] === $name
        );
        $this->assertIsArray($calendar, "Expected {$username} to see calendar {$name}");

        return $calendar;
    }
}
