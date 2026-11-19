<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Push\JmapPushStateResolver;
use Illuminate\Support\Facades\Cache;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Team paths of the JMAP event source (#2243). The CalDAV sources read every Team's
 * collections in one query, so these pin that a user in several Teams still gets the
 * exact state `Foo/get` returns, and that each Team write and each membership change
 * still yields a StateChange for members only.
 */
final class JmapEventSourceTeamsTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use InteractsWithJmapEventSource;
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Cache::flush();
        $this->seedSharedTeam('studio', 'bob', 'alice');
        $this->seedSharedTeam('design', 'bob', 'alice', 'carol');
    }

    /** Teams and a direct share together: every pushed state is the one the app reads. */
    public function test_with_several_teams_every_state_is_the_one_the_apps_read(): void
    {
        $this->seedSharedTeam('ops', 'bob');
        $this->jmapCalendars('bob', [['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => ['name' => 'Own', 'id' => 'own']]], 'c0']]);
        $this->jmapCalendars('alice', [['Calendar/set', ['accountId' => 'alice', 'create' => ['c' => ['name' => 'Roster', 'id' => 'roster']]], 'c0']]);
        $this->jmapCalendars('alice', [['Calendar/set', ['accountId' => 'alice', 'update' => ['roster' => ['shareWith' => ['bob' => ['mayReadItems' => true]]]]], 'c0']]);
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks')->assertOk();
        $this->asUser('bob')->getJson('/api/v1/chat/channels')->assertOk();

        $changed = $this->changedStates($this->readEventSource($this->userBearerToken()), 'bob');

        $calendarState = $this->jmapCalendars('bob', [['Calendar/get', ['accountId' => 'bob'], 'c0']])->json('methodResponses.0.1.state');
        $this->assertSame($calendarState, $changed['Calendar']);
        foreach (['ops', 'studio', 'design'] as $team) {
            $this->assertStringContainsString(CalendarCollectionUris::groupCalendarApiId($team).':', $changed['Calendar']);
            $this->assertStringContainsString(CalendarCollectionUris::groupNotebookApiId($team).':', $changed['Notebook']);
            $this->assertStringContainsString(ChatCollectionUris::groupDefaultUri($team).':', $changed['ChatChannel']);
        }
        $this->assertStringContainsString($this->sharedCalendarId('bob', 'Roster').':', $changed['Calendar']);
        $this->assertSame(
            $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/changes')->assertOk()->json('newState'),
            $changed['TaskList'],
        );
        foreach ([
            'Notebook' => [JmapCapabilities::NOTES, 'Notebook/get'],
            'ChatChannel' => [JmapCapabilities::CHAT, 'ChatChannel/get'],
            'AddressBook' => [JmapCapabilities::CONTACTS, 'AddressBook/get'],
        ] as $type => [$capability, $method]) {
            $state = $this->jmap('bob', $capability, [[$method, ['accountId' => 'bob'], 'c0']])->json('methodResponses.0.1.state');
            $this->assertSame($state, $changed[$type], $type);
        }
        $this->assertStringContainsString('group-ops:', $changed['AddressBook']);
    }

    public function test_a_team_calendar_write_reaches_members_and_not_others(): void
    {
        [$bob, $carol] = $this->firstIds();

        $this->jmapCalendars('alice', [['CalendarEvent/set', ['accountId' => 'alice', 'create' => [
            'e' => $this->sampleCalendarEventPayload(CalendarCollectionUris::groupCalendarApiId('studio')),
        ]], 'c0']])->assertJsonPath('methodResponses.0.1.notCreated', []);

        $this->assertChangedTypes(['CalendarEvent', 'Calendar'], 'bob', $bob);
        $this->assertNothingChanged('carol', $carol);
    }

    public function test_a_team_note_write_reaches_members_and_not_others(): void
    {
        [$bob, $carol] = $this->firstIds();

        $this->asUser('alice')->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::groupNotebookApiId('studio'),
            'title' => 'Plan',
            'body' => 'Agenda',
        ])->assertCreated();

        $this->assertChangedTypes(['Note', 'Notebook'], 'bob', $bob);
        $this->assertNothingChanged('carol', $carol);
    }

    public function test_a_team_task_write_reaches_members_and_not_others(): void
    {
        [$bob, $carol] = $this->firstIds();

        $this->asUser('alice')->postJson('/api/v1/tasks/items', [
            'taskListIds' => [CalendarCollectionUris::groupTaskListApiId('studio') => true],
            'title' => 'Ship it',
        ])->assertCreated();

        $this->assertChangedTypes(['Task', 'TaskList'], 'bob', $bob);
        $this->assertNothingChanged('carol', $carol);
    }

    public function test_a_team_chat_message_reaches_members_and_not_others(): void
    {
        [$bob, $carol] = $this->firstIds();

        $this->asUser('alice')->postJson('/api/v1/chat/channels/'.ChatCollectionUris::groupDefaultUri('studio').'/messages', [
            'id' => '01JZZZZZZZZZZZZZZZZZZZZZTM',
            'body' => 'Morning',
        ])->assertCreated();

        // A Team message also notifies the members, so their inbox moves too.
        $this->assertChangedTypes(['ChatMessage', 'ChatChannel', 'Notification'], 'bob', $bob);
        $this->assertNothingChanged('carol', $carol);
    }

    public function test_a_team_contact_write_reaches_members_and_not_others(): void
    {
        [$bob, $carol] = $this->firstIds();

        $this->jmap('alice', JmapCapabilities::CONTACTS, [['ContactCard/set', ['accountId' => 'alice', 'create' => ['k' => [
            'addressBookIds' => ['group-studio' => true], 'name' => ['full' => 'Supplier'],
        ]]], 'c0']])->assertJsonPath('methodResponses.0.1.notCreated', []);

        $this->assertChangedTypes(['ContactCard', 'AddressBook'], 'bob', $bob);
        $this->assertNothingChanged('carol', $carol);
    }

    public function test_joining_and_leaving_a_team_changes_every_collection_type(): void
    {
        $this->seedSharedTeam('sales', 'alice');
        $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk();
        $before = $this->readEventSource($this->issueBearerTokenFor('carol'));

        $membership = $this->seedSharedTeam('sales', 'carol');
        $joined = $this->changedStates($this->readEventSource($this->issueBearerTokenFor('carol'), '*', $before['id']), 'carol');
        foreach (['Note', 'Notebook', 'CalendarEvent', 'Calendar', 'ContactCard', 'AddressBook', 'ChatMessage', 'ChatChannel', 'FileNode', 'Task', 'TaskList'] as $type) {
            $this->assertArrayHasKey($type, $joined, $type);
        }

        $carolPrincipal = Principal::forUsername('carol');
        $this->assertNotNull($carolPrincipal);
        GroupMember::query()->where('principal_id', $membership->id)->where('member_id', $carolPrincipal->id)->delete();
        $left = $this->readEventSource($this->issueBearerTokenFor('carol'), '*', $before['id']);
        // Back to the states before the join, except the Team channel's member list.
        $this->assertSame([], array_diff(array_keys($this->changedStates($left, 'carol')), ['ChatMessage', 'ChatChannel']));
    }

    public function test_dismissing_and_restoring_an_inbound_share_changes_the_calendar_state(): void
    {
        $this->jmapCalendars('alice', [['Calendar/set', ['accountId' => 'alice', 'create' => ['c' => ['name' => 'Roster', 'id' => 'roster']]], 'c0']]);
        $this->jmapCalendars('alice', [['Calendar/set', ['accountId' => 'alice', 'update' => ['roster' => ['shareWith' => ['bob' => ['mayReadItems' => true]]]]], 'c0']]);
        $roster = $this->sharedCalendarId('bob', 'Roster');
        $shared = $this->readEventSource($this->userBearerToken());

        $this->jmapCalendars('bob', [['Calendar/set', ['accountId' => 'bob', 'update' => [$roster => ['isSubscribed' => false]]], 'c0']])
            ->assertJsonPath('methodResponses.0.1.notUpdated', []);
        $dismissed = $this->readEventSource($this->userBearerToken(), '*', $shared['id']);
        $this->assertSame(['CalendarEvent', 'Calendar'], array_keys($this->changedStates($dismissed, 'bob')));
        $this->assertStringNotContainsString($roster.':', $this->changedStates($dismissed, 'bob')['Calendar']);

        $this->jmapCalendars('bob', [['Calendar/set', ['accountId' => 'bob', 'update' => [$roster => ['isSubscribed' => true]]], 'c0']])
            ->assertJsonPath('methodResponses.0.1.notUpdated', []);
        $restored = $this->readEventSource($this->userBearerToken(), '*', $dismissed['id']);
        $this->assertStringContainsString($roster.':', $this->changedStates($restored, 'bob')['Calendar']);
    }

    /**
     * The first event ids of bob (a member of studio) and carol (not a member).
     *
     * @return array{0: string, 1: string}
     */
    private function firstIds(): array
    {
        // Provision the Team collections the way the apps do before anyone writes.
        $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk();
        $this->jmap('alice', JmapCapabilities::CONTACTS, [['AddressBook/get', ['accountId' => 'alice'], 'c0']]);
        $bob = $this->readEventSource($this->userBearerToken())['id'];
        $carol = $this->readEventSource($this->issueBearerTokenFor('carol'))['id'];
        $this->assertIsString($bob);
        $this->assertIsString($carol);

        return [$bob, $carol];
    }

    /**
     * @param  list<string>  $types
     */
    private function assertChangedTypes(array $types, string $username, string $id): void
    {
        $changed = $this->changedStates($this->readEventSource($this->issueBearerTokenFor($username), '*', $id), $username);
        $this->assertSame($types, array_keys($changed));
        $this->assertSame(
            array_values(array_intersect(JmapPushStateResolver::TYPES, $types)),
            array_keys($changed),
        );
    }

    private function assertNothingChanged(string $username, string $id): void
    {
        $this->assertSame("retry: 3000\n\n", $this->eventSource($this->issueBearerTokenFor($username), '*', $id)->getContent());
    }

    /** The id `$username` sees for a calendar shared with them, by its name. */
    private function sharedCalendarId(string $username, string $name): string
    {
        foreach ($this->jmapCalendars($username, [['Calendar/get', ['accountId' => $username], 'c0']])->json('methodResponses.0.1.list') as $calendar) {
            if (($calendar['name'] ?? null) === $name) {
                return (string) $calendar['id'];
            }
        }
        $this->fail('No calendar named '.$name.' for '.$username);
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapCalendars(string $username, array $methodCalls): TestResponse
    {
        return $this->jmap($username, JmapCapabilities::CALENDARS, $methodCalls);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(string $username, string $capability, array $methodCalls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, $capability],
            'methodCalls' => $methodCalls,
        ])->assertOk();
    }
}
