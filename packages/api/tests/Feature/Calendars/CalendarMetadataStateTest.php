<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\Principal;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\CollectionMetadataStateAssertions;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Renaming or recolouring a calendar moves the Calendar state of everyone who
 * can see it, from the app and from a DAV client alike (#1671).
 */
final class CalendarMetadataStateTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use CollectionMetadataStateAssertions;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedDefaultCalendarFor('alice');
        $this->setUpDavServer();
        $team = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Team');
        foreach (['bob', 'alice'] as $username) {
            $member = Principal::forUsername($username);
            $this->assertNotNull($member);
            $this->addPrincipalToGroup($team, $member);
        }
    }

    public function test_rename_and_recolour_in_the_app_moves_state_for_owner_and_sharee(): void
    {
        [$ownerId, $shareeId] = $this->sharedCalendar('Planning', 'planning');
        $before = $this->states();

        $set = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$ownerId => [
                'name' => 'Planning 2027',
                'color' => '#ff0000',
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertArrayHasKey($ownerId, $set['updated']);
        $this->assertNotSame($set['oldState'], $set['newState']);

        $this->assertCollectionUpdated($this->changes('bob', $before['bob']), $before['bob'], $ownerId, 'bob');
        $this->assertCollectionUpdated($this->changes('alice', $before['alice']), $before['alice'], $shareeId, 'alice');

        $owned = $this->calendar('bob', $ownerId);
        $this->assertSame('Planning 2027', $owned['name']);
        $this->assertSame('#ff0000', $owned['color']);
    }

    public function test_dav_proppatch_rename_and_recolour_moves_state_for_owner_and_sharee(): void
    {
        [$ownerId, $shareeId] = $this->sharedCalendar('Rota', 'rota');
        $before = $this->states();

        $this->davProppatch('bob', '/calendars/bob/'.$ownerId, [
            '{DAV:}displayname' => 'Rota 2027',
            self::APPLE_CALENDAR_COLOR => '#00ff00',
        ]);

        $this->assertCollectionUpdated($this->changes('bob', $before['bob']), $before['bob'], $ownerId, 'bob');
        $this->assertCollectionUpdated($this->changes('alice', $before['alice']), $before['alice'], $shareeId, 'alice');

        $owned = $this->calendar('bob', $ownerId);
        $this->assertSame('Rota 2027', $owned['name']);
        $this->assertSame('#00ff00', $owned['color']);
    }

    public function test_sharee_dav_rename_of_own_copy_moves_their_state(): void
    {
        [, $shareeId] = $this->sharedCalendar('Holidays', 'holidays');
        $before = $this->states();

        $this->davProppatch('alice', '/calendars/alice/'.$shareeId, [
            '{DAV:}displayname' => 'Bob holidays',
            self::APPLE_CALENDAR_COLOR => '#0000ff',
        ]);

        $this->assertCollectionUpdated($this->changes('alice', $before['alice']), $before['alice'], $shareeId, 'alice');
        $seen = $this->calendar('alice', $shareeId);
        $this->assertSame('Bob holidays', $seen['name']);
        $this->assertSame('#0000ff', $seen['color']);
    }

    public function test_group_calendar_rename_reaches_every_member(): void
    {
        $created = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => [
                'name' => 'Team rota',
                'groupSlug' => self::TEAM,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c');
        $id = (string) $created['id'];
        $this->assertSame('Team rota', $this->calendar('alice', $id)['name']);
        $before = $this->states();

        $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$id => [
                'name' => 'Team schedule',
                'color' => '#123456',
            ]]], 'c0'],
        ])->assertOk();

        $this->assertCollectionUpdated($this->changes('alice', $before['alice']), $before['alice'], $id, 'alice');
        $seen = $this->calendar('alice', $id);
        $this->assertSame('Team schedule', $seen['name']);
        $this->assertSame('#123456', $seen['color']);
    }

    /**
     * @return array{0: string, 1: string} the owner's and the sharee's calendar id
     */
    private function sharedCalendar(string $name, string $uri): array
    {
        $ownerId = (string) $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => ['name' => $name, 'id' => $uri]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c.id');

        $set = $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$ownerId => [
                'shareWith' => ['alice' => ['mayWriteAll' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertArrayHasKey($ownerId, $set['updated']);

        $shared = collect($this->calendars('alice'))
            ->first(static fn (array $calendar): bool => ($calendar['name'] ?? '') === $name);
        $this->assertIsArray($shared, 'alice must see calendar '.$name);

        return [$ownerId, (string) $shared['id']];
    }

    /** @return array{bob: string, alice: string} */
    private function states(): array
    {
        return ['bob' => $this->state('bob'), 'alice' => $this->state('alice')];
    }

    private function state(string $username): string
    {
        return (string) $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');
    }

    /** @return array<string, mixed> */
    private function changes(string $username, string $since): array
    {
        return $this->jmapAs($username, [
            ['Calendar/changes', ['accountId' => $username, 'sinceState' => $since], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
    }

    /** @return list<array<string, mixed>> */
    private function calendars(string $username): array
    {
        return $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
    }

    /** @return array<string, mixed> */
    private function calendar(string $username, string $id): array
    {
        $calendar = $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => [$id]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertIsArray($calendar, $username.' must see calendar '.$id);

        return $calendar;
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor($username))->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }
}
