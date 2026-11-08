<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use App\Dav\Server\WgwCalendarBackend;
use App\Models\AddressBookShare;
use App\Models\CalendarInstance;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\AddressBookRepository;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Push\JmapPushStateResolver;
use App\Services\Notes\NotebookRepository;
use App\Services\Tasks\TaskListRepository;
use App\Support\WgwSettings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk E1 of Epic #1915: a calendar-family or address book share from someone who no longer
 * shares a Team with the sharee is hidden on read for both people, admins included, and comes
 * back when they share a Team again. Nothing is deleted.
 *
 * Personas: bob (owner) and dave share T1; carol is in T2 with bob; alice is admin and shares
 * T3 with erin. Leaving and joining a Team is a plain membership change with no other write.
 */
final class TeamHiddenSharesTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, true);
        $this->setAppSetting(WgwSettings::TASKS_ENABLED, true);
        $this->setAppSetting(WgwSettings::NOTES_ENABLED, true);
        $this->seedWgwUser('dave', displayName: 'Dave');
        $this->seedWgwUser('erin', displayName: 'Erin');

        $this->seedSharedTeam('t1', 'bob', 'dave');
        $this->seedSharedTeam('t2', 'bob', 'carol');
        $this->seedSharedTeam('t3', 'alice', 'erin');
        foreach (['alice', 'bob', 'carol', 'dave', 'erin'] as $username) {
            app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/'.$username);
        }
        $this->seedDefaultCalendarFor('alice');
    }

    public function test_a_calendar_share_is_hidden_for_both_when_they_share_no_team_and_comes_back(): void
    {
        $sharedId = $this->newCalendarId('dave', fn () => $this->shareCalendar('bob', 'default', 'dave'));
        $eventId = $this->createEvent('bob', 'default');
        $before = $this->calendarStates('dave');
        $rows = $this->grantRowSnapshot();

        $this->leave('dave', 't1');

        $this->assertNotContains($sharedId, $this->calendarIds('dave'));
        $this->assertNull($this->ownerShareWith('bob', 'default'));
        $this->assertJmapChanges('dave', JmapCapabilities::CALENDARS, 'Calendar/changes', $before['calendar'], destroyed: [$sharedId]);
        $this->assertJmapChanges('dave', JmapCapabilities::CALENDARS, 'CalendarEvent/changes', $before['events'], destroyed: [$eventId]);
        $this->assertNotSame($before['push'], $this->pushState('dave', 'Calendar'));
        $hidden = $this->calendarStates('dave');
        $this->assertSame($rows, $this->grantRowSnapshot());

        $this->join('dave', 't1');

        $this->assertContains($sharedId, $this->calendarIds('dave'));
        $this->assertArrayHasKey('dave', (array) $this->ownerShareWith('bob', 'default'));
        $this->assertJmapChanges('dave', JmapCapabilities::CALENDARS, 'Calendar/changes', $hidden['calendar'], created: [$sharedId]);
        $this->assertJmapChanges('dave', JmapCapabilities::CALENDARS, 'CalendarEvent/changes', $hidden['events'], created: [$eventId]);
        $this->assertSame($before['push'], $this->pushState('dave', 'Calendar'));
        $this->assertSame($rows, $this->grantRowSnapshot());
    }

    public function test_a_dm_and_a_calendar_share_between_an_admin_and_a_user_are_hidden_for_both(): void
    {
        $dmId = (string) $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'erin'])->assertOk()->json('id');
        $sharedId = $this->newCalendarId('erin', fn () => $this->shareCalendar('alice', 'default', 'erin'));

        $this->leave('erin', 't3');

        foreach (['alice', 'erin'] as $username) {
            $this->assertNotContains($dmId, $this->channelIds($username));
            $this->asUser($username)->getJson('/api/v1/chat/channels/'.$dmId)->assertNotFound();
        }
        $this->assertNotContains($sharedId, $this->calendarIds('erin'));
        $this->assertNull($this->ownerShareWith('alice', 'default'));

        $this->join('erin', 't3');

        foreach (['alice', 'erin'] as $username) {
            $this->assertContains($dmId, $this->channelIds($username));
            $this->asUser($username)->getJson('/api/v1/chat/channels/'.$dmId)->assertOk();
        }
        $this->assertContains($sharedId, $this->calendarIds('erin'));
    }

    public function test_task_list_notebook_and_channel_changes_report_hidden_as_destroyed_and_returning_as_created(): void
    {
        $routes = ['/api/v1/tasks/tasklists/changes', '/api/v1/notes/notebooks/changes', '/api/v1/chat/channels/changes'];
        $states = [];
        foreach ($routes as $route) {
            $states[$route] = (string) $this->asUser('dave')->getJson($route)->assertOk()->json('newState');
        }
        $this->sharedCollection('/api/v1/tasks/tasklists/', (string) app(TaskListRepository::class)->create('bob', ['name' => 'Shared list'])['id'], ['dave' => ['mayReadItems' => true]]);
        $this->sharedCollection('/api/v1/notes/notebooks/', (string) app(NotebookRepository::class)->create('bob', ['name' => 'Shared notebook'])['id'], ['dave' => ['mayWriteAll' => true]]);
        $this->sharedCollection('/api/v1/chat/channels/', (string) app(ChatChannelRepository::class)->create('bob', ['name' => 'Shared channel', 'kind' => 'channel'])['id'], ['dave' => ['mayWriteAll' => true]]);
        $shared = [];
        foreach ($routes as $route) {
            $delta = $this->asUser('dave')->getJson($route.'?since='.urlencode($states[$route]))->assertOk();
            // The sharee's id for the collection, exactly one new one per route.
            $shared[$route] = (array) $delta->json('created');
            $this->assertCount(1, $shared[$route], $route);
            $states[$route] = (string) $delta->json('newState');
        }

        $this->leave('dave', 't1');

        foreach ($routes as $route) {
            $delta = $this->asUser('dave')->getJson($route.'?since='.urlencode($states[$route]))->assertOk();
            // Leaving T1 also drops the Team's own collections; the hidden share is among them.
            $this->assertContains($shared[$route][0], (array) $delta->json('destroyed'), $route);
            $states[$route] = (string) $delta->json('newState');
        }

        $this->join('dave', 't1');

        foreach ($routes as $route) {
            $delta = $this->asUser('dave')->getJson($route.'?since='.urlencode($states[$route]))->assertOk();
            $this->assertContains($shared[$route][0], (array) $delta->json('created'), $route);
        }
    }

    public function test_note_changes_list_every_note_of_a_hidden_notebook(): void
    {
        $notebook = $this->sharedCollection('/api/v1/notes/notebooks/', (string) app(NotebookRepository::class)->create('bob', ['name' => 'Shared notes'])['id'], ['dave' => ['mayWriteAll' => true]]);
        $noteId = (string) $this->jmap('bob', JmapCapabilities::NOTES, [
            ['Note/set', ['accountId' => 'bob', 'create' => ['k0' => ['notebookId' => $notebook, 'title' => 'Hello', 'body' => 'World']]], 'c0'],
        ])->json('methodResponses.0.1.created.k0.id');
        $state = $this->jmapState('dave', JmapCapabilities::NOTES, 'Note/get');

        $this->leave('dave', 't1');
        $hidden = $this->assertJmapChanges('dave', JmapCapabilities::NOTES, 'Note/changes', $state, destroyed: [$noteId]);

        $this->join('dave', 't1');
        $this->assertJmapChanges('dave', JmapCapabilities::NOTES, 'Note/changes', $hidden, created: [$noteId]);
    }

    public function test_an_address_book_share_is_hidden_for_both_and_comes_back(): void
    {
        app(AddressBookRepository::class)->update('bob', AddressBookCollectionUris::PERSONAL_DEFAULT, [
            'shareWith' => ['dave' => ['mayRead' => true, 'mayWrite' => false]],
        ]);
        $cardId = (string) $this->jmap('bob', JmapCapabilities::CONTACTS, [
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => [
                'addressBookIds' => [AddressBookCollectionUris::PERSONAL_DEFAULT => true],
                'name' => ['full' => 'Jane Shared'],
            ]]], 'c0'],
        ])->json('methodResponses.0.1.created.k0.id');
        $sharedId = $this->onlyNewAddressBookId('dave');
        $books = $this->jmapState('dave', JmapCapabilities::CONTACTS, 'AddressBook/get');
        $cards = $this->jmapState('dave', JmapCapabilities::CONTACTS, 'ContactCard/get');
        $tokens = app(AddressBookRepository::class)->syncTokens('dave');
        $this->assertArrayHasKey($sharedId, $tokens);
        $push = $this->pushState('dave', 'AddressBook');
        $rows = AddressBookShare::query()->orderBy('id')->get()->map->getAttributes()->all();

        $this->leave('dave', 't1');

        $this->assertNotContains($sharedId, $this->addressBookIds('dave'));
        $this->assertArrayNotHasKey($sharedId, app(AddressBookRepository::class)->syncTokens('dave'));
        $this->assertArrayNotHasKey('dave', (array) $this->addressBookShareWith('bob'));
        $hiddenBooks = $this->assertJmapChanges('dave', JmapCapabilities::CONTACTS, 'AddressBook/changes', $books, destroyed: [$sharedId]);
        $hiddenCards = $this->assertJmapChanges('dave', JmapCapabilities::CONTACTS, 'ContactCard/changes', $cards, destroyed: [$cardId]);
        $this->assertNotSame($push, $this->pushState('dave', 'AddressBook'));
        $this->assertSame($rows, AddressBookShare::query()->orderBy('id')->get()->map->getAttributes()->all());

        $this->join('dave', 't1');

        $this->assertContains($sharedId, $this->addressBookIds('dave'));
        $this->assertArrayHasKey('dave', (array) $this->addressBookShareWith('bob'));
        $this->assertJmapChanges('dave', JmapCapabilities::CONTACTS, 'AddressBook/changes', $hiddenBooks, created: [$sharedId]);
        $this->assertJmapChanges('dave', JmapCapabilities::CONTACTS, 'ContactCard/changes', $hiddenCards, created: [$cardId]);
    }

    public function test_chat_message_changes_keep_pruning_by_channel(): void
    {
        $channel = $this->sharedCollection('/api/v1/chat/channels/', (string) app(ChatChannelRepository::class)->create('bob', ['name' => 'Quiet', 'kind' => 'channel'])['id'], ['dave' => ['mayWriteAll' => true]]);
        $this->asUser('bob')->postJson('/api/v1/chat/channels/'.$channel.'/messages', [
            'id' => '01HZZZZZZZZZZZZZZZZZZZZZZA',
            'body' => 'hello',
        ])->assertCreated();
        $channels = $this->jmapState('dave', JmapCapabilities::CHAT, 'ChatChannel/get');
        $messages = $this->jmapState('dave', JmapCapabilities::CHAT, 'ChatMessage/get');

        $this->leave('dave', 't1');

        $this->assertJmapChanges('dave', JmapCapabilities::CHAT, 'ChatChannel/changes', $channels, destroyed: [$channel]);
        // Documented: no per-message destroyed; the client prunes the destroyed channel's messages.
        $this->assertJmapChanges('dave', JmapCapabilities::CHAT, 'ChatMessage/changes', $messages);
    }

    public function test_patch_writes_leave_hidden_grants_and_revoke_all_removes_them(): void
    {
        $this->shareCalendar('bob', 'default', 'dave');
        $this->leave('dave', 't1');
        $daveRow = CalendarInstance::query()->where('principaluri', 'principals/dave')->where('access', '!=', SharingPlugin::ACCESS_SHAREDOWNER)->firstOrFail()->getAttributes();

        $this->shareCalendar('bob', 'default', 'carol');

        $this->assertSame($daveRow, CalendarInstance::query()->whereKey($daveRow['id'])->firstOrFail()->getAttributes());
        $this->assertSame(['carol'], array_keys((array) $this->ownerShareWith('bob', 'default')));

        $this->jmap('bob', JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => 'bob', 'update' => ['default' => ['shareWith' => null]]], 'c0'],
        ])->assertJsonPath('methodResponses.0.1.updated.default', null);
        $this->assertNull(CalendarInstance::query()->whereKey($daveRow['id'])->first());

        $this->join('dave', 't1');
        $this->assertNull($this->ownerShareWith('bob', 'default'));
    }

    public function test_address_book_revoke_all_removes_hidden_grants(): void
    {
        $books = app(AddressBookRepository::class);
        $books->update('bob', AddressBookCollectionUris::PERSONAL_DEFAULT, ['shareWith' => ['dave' => ['mayRead' => true, 'mayWrite' => false]]]);
        $this->leave('dave', 't1');
        $books->update('bob', AddressBookCollectionUris::PERSONAL_DEFAULT, ['shareWith' => ['carol' => ['mayRead' => true, 'mayWrite' => false]]]);
        $this->assertSame(2, AddressBookShare::query()->count());

        $books->update('bob', AddressBookCollectionUris::PERSONAL_DEFAULT, ['shareWith' => null]);

        $this->assertSame(0, AddressBookShare::query()->count());
    }

    public function test_team_owned_collections_are_never_hidden_and_restore_does_not_bypass_hiding(): void
    {
        $teamCalendar = (string) $this->jmap('bob', JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => ['name' => 'T2 board', 'groupSlug' => 't2']]], 'c0'],
        ])->json('methodResponses.0.1.created.c.id');
        $this->assertNotSame('', $teamCalendar);
        $this->jmap('bob', JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$teamCalendar => ['shareWith' => ['dave' => ['mayReadItems' => true]]]]], 'c0'],
        ]);
        $personalShared = $this->newCalendarId('dave', fn () => $this->shareCalendar('bob', 'default', 'dave'));
        $teamShared = $this->calendarIdNamed('dave', 'T2 board');
        $this->jmap('dave', JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => 'dave', 'update' => [$personalShared => ['isSubscribed' => false]]], 'c0'],
        ]);

        $this->leave('dave', 't1');
        $this->jmap('dave', JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => 'dave', 'update' => [$personalShared => ['isSubscribed' => true]]], 'c0'],
        ]);

        $this->assertContains($teamShared, $this->calendarIds('dave'));
        $this->assertNotContains($personalShared, $this->calendarIds('dave'));
    }

    public function test_native_caldav_home_and_owner_invites_leave_out_the_hidden_share(): void
    {
        $this->shareCalendar('bob', 'default', 'dave');
        $calendarId = (int) CalendarInstance::query()->where('principaluri', 'principals/bob')->where('uri', 'default')->value('calendarid');
        $ownerInstance = (int) CalendarInstance::query()->where('principaluri', 'principals/bob')->where('uri', 'default')->value('id');
        $backend = new WgwCalendarBackend(DB::connection('wgw')->getPdo());
        $davCalendarIds = fn (): array => array_map(
            static fn (array $calendar): int => (int) $calendar['id'][0],
            $backend->getCalendarsForUser('principals/dave'),
        );
        $invitees = fn (): array => array_values(array_filter(array_map(
            static fn ($sharee): ?string => $sharee->principal,
            $backend->getInvites([$calendarId, $ownerInstance]),
        )));
        $this->assertContains($calendarId, $davCalendarIds());

        $this->leave('dave', 't1');
        $this->assertNotContains($calendarId, $davCalendarIds());
        $this->assertSame(['principals/bob'], $invitees());

        $this->join('dave', 't1');
        $this->assertContains($calendarId, $davCalendarIds());
        $this->assertContains('principals/dave', $invitees());
    }

    public function test_people_inside_a_channel_still_show_by_name(): void
    {
        $channel = $this->sharedCollection(
            '/api/v1/chat/channels/',
            (string) app(ChatChannelRepository::class)->create('bob', ['name' => 'Mixed', 'kind' => 'channel'])['id'],
            ['dave' => ['mayWriteAll' => true], 'carol' => ['mayWriteAll' => true]],
        );

        // dave and carol share no Team, but both see each other in a channel they can open.
        $this->asUser('dave')->getJson('/api/v1/chat/channels/'.$channel)->assertOk()
            ->assertJsonPath('members', ['bob', 'carol', 'dave']);
    }

    public function test_the_registries_behind_item_changes_are_not_filtered(): void
    {
        // Item-level destroyed comes from the per-viewer id registries; a visibility filter
        // there would leave destroyed empty after hiding. Guard the class names they live in.
        foreach ([
            app_path('Services/Calendars/JmapCalendarEventStateService.php'),
            app_path('Services/Contacts/JmapContactStateService.php'),
            app_path('Services/Notes/JmapNoteStateService.php'),
        ] as $path) {
            $source = (string) file_get_contents($path);
            $this->assertStringNotContainsString('ShareVisibility', $source, $path);
            $this->assertStringNotContainsString('TeamColleagues', $source, $path);
        }
    }

    /**
     * Shares one of bob's collections over REST, as the app does, and returns its id.
     *
     * @param  array<string, array<string, bool>>  $shareWith
     */
    private function sharedCollection(string $route, string $id, array $shareWith): string
    {
        $this->asUser('bob')->patchJson($route.$id, ['shareWith' => $shareWith])->assertOk();

        return $id;
    }

    private function shareCalendar(string $owner, string $calendarId, string $sharee): void
    {
        $response = $this->jmap($owner, JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => $owner, 'update' => [$calendarId => [
                'shareWith' => [$sharee => ['mayReadItems' => true]],
            ]]], 'c0'],
        ]);
        $this->assertEmpty($response->json('methodResponses.0.1.notUpdated'));
    }

    private function createEvent(string $owner, string $calendarId): string
    {
        return (string) $this->jmap($owner, JmapCapabilities::CALENDARS, [
            ['CalendarEvent/set', ['accountId' => $owner, 'create' => ['e' => $this->sampleCalendarEventPayload($calendarId)]], 'c0'],
        ])->json('methodResponses.0.1.created.e.id');
    }

    private function newCalendarId(string $username, callable $share): string
    {
        $before = $this->calendarIds($username);
        $share();
        $new = array_values(array_diff($this->calendarIds($username), $before));
        $this->assertCount(1, $new);

        return $new[0];
    }

    private function calendarIdNamed(string $username, string $name): string
    {
        $calendars = (array) $this->jmap($username, JmapCapabilities::CALENDARS, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->json('methodResponses.0.1.list');
        foreach ($calendars as $calendar) {
            if (($calendar['name'] ?? null) === $name) {
                return (string) $calendar['id'];
            }
        }
        $this->fail('No calendar named '.$name);
    }

    /**
     * @return list<string>
     */
    private function calendarIds(string $username): array
    {
        return array_column((array) $this->jmap($username, JmapCapabilities::CALENDARS, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->json('methodResponses.0.1.list'), 'id');
    }

    private function ownerShareWith(string $owner, string $calendarId): mixed
    {
        return $this->jmap($owner, JmapCapabilities::CALENDARS, [
            ['Calendar/get', ['accountId' => $owner, 'ids' => [$calendarId]], 'c0'],
        ])->json('methodResponses.0.1.list.0.shareWith');
    }

    /**
     * @return list<string>
     */
    private function addressBookIds(string $username): array
    {
        return array_column((array) $this->jmap($username, JmapCapabilities::CONTACTS, [
            ['AddressBook/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->json('methodResponses.0.1.list'), 'id');
    }

    private function onlyNewAddressBookId(string $username): string
    {
        $new = array_values(array_filter(
            $this->addressBookIds($username),
            static fn (string $id): bool => AddressBookCollectionUris::parseSharedApiId($id) !== null,
        ));
        $this->assertCount(1, $new);

        return $new[0];
    }

    private function addressBookShareWith(string $owner): mixed
    {
        return $this->jmap($owner, JmapCapabilities::CONTACTS, [
            ['AddressBook/get', ['accountId' => $owner, 'ids' => [AddressBookCollectionUris::PERSONAL_DEFAULT]], 'c0'],
        ])->json('methodResponses.0.1.list.0.shareWith');
    }

    /**
     * @return list<string>
     */
    private function channelIds(string $username): array
    {
        return array_column((array) $this->asUser($username)->getJson('/api/v1/chat/channels')->assertOk()->json('list'), 'id');
    }

    /**
     * @return array{calendar: string, events: string, push: string}
     */
    private function calendarStates(string $username): array
    {
        return [
            'calendar' => $this->jmapState($username, JmapCapabilities::CALENDARS, 'Calendar/get'),
            'events' => $this->jmapState($username, JmapCapabilities::CALENDARS, 'CalendarEvent/get'),
            'push' => $this->pushState($username, 'Calendar'),
        ];
    }

    private function jmapState(string $username, string $capability, string $method): string
    {
        return (string) $this->jmap($username, $capability, [
            [$method, ['accountId' => $username, 'ids' => null], 'c0'],
        ])->json('methodResponses.0.1.state');
    }

    /**
     * @param  list<string>  $created
     * @param  list<string>  $destroyed
     */
    private function assertJmapChanges(
        string $username,
        string $capability,
        string $method,
        string $since,
        array $created = [],
        array $destroyed = [],
    ): string {
        $delta = (array) $this->jmap($username, $capability, [
            [$method, ['accountId' => $username, 'sinceState' => $since], 'c0'],
        ])->assertJsonPath('methodResponses.0.0', $method)->json('methodResponses.0.1');
        foreach ($created as $id) {
            $this->assertContains($id, (array) $delta['created'], $method.' created');
        }
        foreach ($destroyed as $id) {
            $this->assertContains($id, (array) $delta['destroyed'], $method.' destroyed');
        }
        if ($created === [] && $destroyed === []) {
            $this->assertSame([], $delta['destroyed'], $method.' destroyed');
        }

        return (string) $delta['newState'];
    }

    private function pushState(string $username, string $type): string
    {
        $this->forgetRequestState();

        return app(JmapPushStateResolver::class)->resolve($username, [$type])['states'][$type]['state'];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function grantRowSnapshot(): array
    {
        return CalendarInstance::query()->orderBy('id')->get()->map->getAttributes()->all();
    }

    private function leave(string $username, string $team): void
    {
        GroupMember::query()
            ->where('principal_id', Principal::query()->where('uri', 'principals/groups/'.$team)->value('id'))
            ->where('member_id', Principal::forUsername($username)?->id)
            ->delete();
        $this->forgetRequestState();
    }

    private function join(string $username, string $team): void
    {
        $this->seedSharedTeam($team, $username);
        $this->forgetRequestState();
    }

    private function forgetRequestState(): void
    {
        $this->app->instance('request', Request::create('/'));
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     */
    private function jmap(string $username, string $capability, array $calls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, $capability],
            'methodCalls' => $calls,
        ])->assertOk();
    }

    private function asUser(string $username): static
    {
        $this->tokens[$username] ??= $this->issueBearerTokenFor($username);

        return $this->withBearer($this->tokens[$username]);
    }
}
