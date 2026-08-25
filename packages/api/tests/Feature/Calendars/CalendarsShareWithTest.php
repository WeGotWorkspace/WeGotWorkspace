<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarShareDismissal;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarShareVisibility;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * JMAP Calendar/set shareWith + event ACL on shared instances (Task #606 / Chunk A).
 */
final class CalendarsShareWithTest extends WgwDatabaseTestCase
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

    public function test_owner_can_share_personal_calendar_read_only(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Shared Projects', 'shared-projects');

        $response = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'shareWith' => ['alice' => ['mayReadItems' => true]],
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.'.$calendarId));
        $shareWith = $response->json('methodResponses.1.1.list.0.shareWith');
        $this->assertIsArray($shareWith['alice']);
        $this->assertTrue($shareWith['alice']['mayReadItems']);
        $this->assertFalse($shareWith['alice']['mayWriteAll']);
        $this->assertFalse($shareWith['alice']['mayShare']);

        $href = CalendarInstance::query()
            ->where('principaluri', 'principals/alice')
            ->where('share_href', '!=', '')
            ->value('share_href');
        $this->assertSame('mailto:alice@example.test', $href);

        $shared = $this->calendarNamed('alice', 'Shared Projects');
        $this->assertNotSame($calendarId, $shared['id']);
        $this->assertNull($shared['shareWith']);
        $this->assertFalse($shared['myRights']['mayShare']);
        $this->assertFalse($shared['myRights']['mayWriteAll']);
        $this->assertTrue($shared['myRights']['mayReadItems']);
    }

    public function test_read_share_denies_event_create_update_and_delete(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Read Only Share', 'read-only-share');
        $this->shareCalendar('bob', $calendarId, 'alice', write: false);
        $sharedId = (string) $this->calendarNamed('alice', 'Read Only Share')['id'];

        $ownerEventId = (string) $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['e' => array_merge(
                $this->sampleCalendarEventPayload($calendarId),
                ['title' => 'Owner event'],
            )]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.e.id');

        $viewed = $this->jmapAs('alice', [
            ['CalendarEvent/get', ['accountId' => 'alice', 'ids' => [$ownerEventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('Owner event', $viewed['list'][0]['title'] ?? null);

        $denied = $this->jmapAs('alice', [
            ['CalendarEvent/set', [
                'accountId' => 'alice',
                'create' => ['new' => array_merge(
                    $this->sampleCalendarEventPayload($sharedId),
                    ['title' => 'Should fail'],
                )],
                'update' => [$ownerEventId => ['title' => 'Hijacked']],
                'destroy' => [$ownerEventId],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('forbidden', $denied['notCreated']['new']['type']);
        $this->assertSame('forbidden', $denied['notUpdated'][$ownerEventId]['type']);
        $this->assertSame('forbidden', $denied['notDestroyed'][$ownerEventId]['type']);
        $this->assertSame([], $denied['created']);
        $this->assertSame([], $denied['updated']);
        $this->assertSame([], $denied['destroyed']);
    }

    public function test_write_share_allows_event_create_update_and_delete(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Write Share', 'write-share');
        $this->shareCalendar('bob', $calendarId, 'alice', write: true);
        $sharedId = (string) $this->calendarNamed('alice', 'Write Share')['id'];

        $created = $this->jmapAs('alice', [
            ['CalendarEvent/set', ['accountId' => 'alice', 'create' => ['e' => array_merge(
                $this->sampleCalendarEventPayload($sharedId),
                ['title' => 'Alice event'],
            )]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $eventId = (string) $created['created']['e']['id'];
        $this->assertNotSame('', $eventId);
        $this->assertArrayNotHasKey('e', $created['notCreated']);

        $updated = $this->jmapAs('alice', [
            ['CalendarEvent/set', ['accountId' => 'alice', 'update' => [$eventId => [
                'title' => 'Alice event edited',
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertArrayHasKey($eventId, $updated['updated']);
        $this->assertArrayNotHasKey($eventId, $updated['notUpdated']);

        $destroyed = $this->jmapAs('alice', [
            ['CalendarEvent/set', ['accountId' => 'alice', 'destroy' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$eventId], $destroyed['destroyed']);
    }

    public function test_owner_can_change_permission_and_revoke(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Revoke Share', 'revoke-share');
        $this->shareCalendar('bob', $calendarId, 'alice', write: false);

        $promoted = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'shareWith' => ['alice' => ['mayWriteAll' => true]],
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();
        $this->assertTrue($promoted->json('methodResponses.1.1.list.0.shareWith.alice.mayWriteAll'));
        $this->assertTrue($this->calendarNamed('alice', 'Revoke Share')['myRights']['mayWriteAll']);

        $revoked = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'shareWith' => ['alice' => null],
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();
        $this->assertNull($revoked->json('methodResponses.1.1.list.0.shareWith'));

        $aliceNames = array_column($this->jmapAs('alice', [
            ['Calendar/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Revoke Share', $aliceNames);
    }

    public function test_revoke_reports_calendar_destroyed_on_sharee_changes(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Changes Revoke', 'changes-revoke');
        $before = $this->jmapAs('alice', [
            ['Calendar/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $this->shareCalendar('bob', $calendarId, 'alice', write: false);
        $sharedId = (string) $this->calendarNamed('alice', 'Changes Revoke')['id'];
        $afterShare = $this->jmapAs('alice', [
            ['Calendar/changes', ['accountId' => 'alice', 'sinceState' => $before], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($sharedId, $afterShare['created']);

        $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'shareWith' => ['alice' => null],
            ]]], 'c0'],
        ])->assertOk();

        $afterRevoke = $this->jmapAs('alice', [
            ['Calendar/changes', ['accountId' => 'alice', 'sinceState' => $afterShare['newState']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($sharedId, $afterRevoke['destroyed']);
    }

    public function test_sharee_can_set_own_name_and_color_without_changing_owner(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Color Share', 'color-share', '#6366f1');
        $this->shareCalendar('bob', $calendarId, 'alice', write: false);
        $sharedId = (string) $this->calendarNamed('alice', 'Color Share')['id'];

        $response = $this->jmapAs('alice', [
            ['Calendar/set', ['accountId' => 'alice', 'update' => [$sharedId => [
                'name' => 'Family (mine)',
                'color' => '#ef4444',
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'alice', 'ids' => [$sharedId]], 'c1'],
        ])->assertOk();
        $this->assertNull($response->json('methodResponses.0.1.notUpdated.'.$sharedId));
        $this->assertSame('Family (mine)', $response->json('methodResponses.1.1.list.0.name'));
        $this->assertSame('#ef4444', $response->json('methodResponses.1.1.list.0.color'));

        $owner = $this->jmapAs('bob', [
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('#6366f1', $owner['color']);
        $this->assertSame('Color Share', $owner['name']);
    }

    public function test_sharee_cannot_change_owner_fields_on_a_shared_calendar(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Locked Fields', 'locked-fields', '#0ea5e9');
        $this->shareCalendar('bob', $calendarId, 'alice', write: true);
        $sharedId = (string) $this->calendarNamed('alice', 'Locked Fields')['id'];

        $patched = $this->jmapAs('alice', [
            ['Calendar/set', ['accountId' => 'alice', 'update' => [$sharedId => [
                'description' => 'Hijacked',
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('forbidden', $patched['notUpdated'][$sharedId]['type']);

        $owner = $this->jmapAs('bob', [
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('Locked Fields', $owner['name']);
        $this->assertSame('#0ea5e9', $owner['color']);
    }

    public function test_sharee_can_dismiss_shared_calendar_without_revoking_owner_grant(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Leave Me', 'leave-me');
        $this->shareCalendar('bob', $calendarId, 'alice', write: false);
        $shared = $this->calendarNamed('alice', 'Leave Me');
        $sharedId = (string) $shared['id'];
        $this->assertTrue($shared['myRights']['mayDelete']);
        $calendarPk = (int) CalendarInstance::query()
            ->where('principaluri', 'principals/alice')
            ->where('uri', $sharedId)
            ->value('calendarid');

        $destroyed = $this->jmapAs('alice', [
            ['Calendar/set', ['accountId' => 'alice', 'destroy' => [$sharedId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$sharedId], $destroyed['destroyed']);
        $this->assertTrue(
            CalendarShareDismissal::query()->where('username', 'alice')->where('calendarid', $calendarPk)->exists(),
            'Expected a share dismissal for alice',
        );

        $aliceNames = array_column($this->jmapAs('alice', [
            ['Calendar/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Leave Me', $aliceNames);

        $owner = $this->jmapAs('bob', [
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('Leave Me', $owner['name']);
        $this->assertIsArray($owner['shareWith']['alice']);

        app(CalendarShareVisibility::class)->restore('alice', $calendarPk);
        $this->assertSame('Leave Me', $this->calendarNamed('alice', 'Leave Me')['name']);
    }

    public function test_write_sharee_cannot_publish_or_unpublish_feed(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Feed Share', 'feed-share');
        $this->shareCalendar('bob', $calendarId, 'alice', write: true);
        $sharedId = (string) $this->calendarNamed('alice', 'Feed Share')['id'];
        $alice = $this->withBearer($this->issueBearerTokenFor('alice'));

        $alice->postJson('/api/v1/calendars/'.$sharedId.'/feed')->assertForbidden();
        $alice->getJson('/api/v1/calendars/'.$sharedId.'/feed')->assertForbidden();
        $alice->deleteJson('/api/v1/calendars/'.$sharedId.'/feed')->assertForbidden();
    }

    public function test_owner_can_share_personal_calendar_with_a_group(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Group Share', 'shared-with-team');

        $response = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'shareWith' => ['groups/'.self::TEAM => ['mayWriteAll' => true]],
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.'.$calendarId));
        $grant = $response->json('methodResponses.1.1.list.0.shareWith.groups/'.self::TEAM);
        $this->assertIsArray($grant);
        $this->assertTrue($grant['mayWriteAll']);

        $href = CalendarInstance::query()
            ->where('principaluri', 'principals/groups/'.self::TEAM)
            ->whereNotNull('share_href')
            ->value('share_href');
        $this->assertSame('mailto:groups/'.self::TEAM, $href);

        $bobNames = array_column($this->jmapAs('bob', [
            ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertSame(1, count(array_filter($bobNames, static fn (string $name): bool => $name === 'Group Share')));
        $owned = $this->calendarNamed('bob', 'Group Share');
        $this->assertSame($calendarId, $owned['id']);
        $this->assertTrue($owned['myRights']['mayShare']);

        $alice = Principal::forUsername('alice');
        $team = Principal::query()->where('uri', 'principals/groups/'.self::TEAM)->first();
        $this->assertNotNull($alice);
        $this->assertNotNull($team);
        $this->addPrincipalToGroup($team, $alice);
        $shared = $this->calendarNamed('alice', 'Group Share');
        $this->assertNotSame($calendarId, $shared['id']);
        $this->assertTrue($shared['myRights']['mayWriteAll']);
        $this->assertNull($shared['shareWith']);

        $carolIds = array_column($this->jmapAs('carol', [
            ['Calendar/get', ['accountId' => 'carol', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Group Share', $carolIds);
    }

    public function test_sharing_home_with_own_group_does_not_list_it_twice(): void
    {
        $homeId = $this->createPersonalCalendar('bob', 'Home', CalendarCollectionUris::EVENT_HOME);
        $this->shareCalendar('bob', $homeId, 'groups/'.self::TEAM, write: false);

        $homes = array_values(array_filter(
            $this->jmapAs('bob', [
                ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ])->assertOk()->json('methodResponses.0.1.list'),
            static fn (array $row): bool => $row['name'] === 'Home',
        ));
        $this->assertCount(1, $homes);
        $this->assertSame($homeId, $homes[0]['id']);
        $this->assertTrue($homes[0]['myRights']['mayShare']);
        $this->assertTrue($homes[0]['myRights']['mayWriteAll']);
    }

    public function test_non_owner_cannot_share(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Owner Only', 'owner-only');
        $this->shareCalendar('bob', $calendarId, 'alice', write: true);
        $sharedId = (string) $this->calendarNamed('alice', 'Owner Only')['id'];

        $sharee = $this->jmapAs('alice', [
            ['Calendar/set', ['accountId' => 'alice', 'update' => [$sharedId => [
                'shareWith' => ['carol' => ['mayReadItems' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('forbidden', $sharee['notUpdated'][$sharedId]['type']);

        $outsider = $this->jmapAs('carol', [
            ['Calendar/set', ['accountId' => 'carol', 'update' => [$calendarId => [
                'shareWith' => ['alice' => ['mayReadItems' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('notFound', $outsider['notUpdated'][$calendarId]['type']);
    }

    public function test_group_member_can_share_group_calendar(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $response = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'shareWith' => ['alice' => ['mayReadItems' => true]],
            ]]], 'c0'],
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.'.$calendarId));
        $grant = $response->json('methodResponses.1.1.list.0.shareWith.alice');
        $this->assertIsArray($grant);
        $this->assertTrue($grant['mayReadItems']);
        $this->assertFalse($grant['mayWriteAll']);
        $this->assertTrue($response->json('methodResponses.1.1.list.0.myRights.mayShare'));

        $shared = $this->calendarNamed('alice', 'Team');
        $this->assertNull($shared['shareWith']);
        $this->assertFalse($shared['myRights']['mayShare']);
        $this->assertFalse($shared['myRights']['mayWriteAll']);
        $this->assertTrue($shared['myRights']['mayReadItems']);
    }

    private function createPersonalCalendar(string $username, string $name, string $id, ?string $color = null): string
    {
        $created = $this->jmapAs($username, [
            ['Calendar/set', ['accountId' => $username, 'create' => ['c' => array_filter([
                'name' => $name,
                'id' => $id,
                'color' => $color,
            ], static fn (mixed $value): bool => $value !== null)]], 'c0'],
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
    private function calendarNamed(string $username, string $name, ?string $skipId = null): array
    {
        $list = $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $calendar = collect($list)->first(
            static fn (array $row): bool => $row['name'] === $name && ($skipId === null || $row['id'] !== $skipId)
        );
        $this->assertIsArray($calendar, "Expected {$username} to see calendar {$name}");

        return $calendar;
    }
}
