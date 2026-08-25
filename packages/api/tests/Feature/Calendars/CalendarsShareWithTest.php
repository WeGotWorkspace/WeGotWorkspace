<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
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

        $shared = $this->calendarNamed('bob', 'Group Share', skipId: $calendarId);
        $this->assertTrue($shared['myRights']['mayWriteAll']);
        $this->assertNull($shared['shareWith']);

        $carolIds = array_column($this->jmapAs('carol', [
            ['Calendar/get', ['accountId' => 'carol', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Group Share', $carolIds);
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

    public function test_group_calendar_rejects_share_with(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $args = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => [
                'shareWith' => ['alice' => ['mayReadItems' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('forbidden', $args['notUpdated'][$calendarId]['type'] ?? null);
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
