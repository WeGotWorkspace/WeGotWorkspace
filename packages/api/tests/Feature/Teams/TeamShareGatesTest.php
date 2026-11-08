<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use App\Models\AddressBookShare;
use App\Models\CalendarInstance;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Illuminate\Http\Request;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk D of Epic #1915: DM open and every calendar-family and address book share write
 * refuse someone outside the caller's Teams (admins too) exactly like an unknown name.
 *
 * Personas: bob and dave share T1; carol is alone in T2; alice is admin and in no Team but
 * the old administrators group. `ghost` and `groups/nope` do not exist.
 */
final class TeamShareGatesTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use RefusedLikeUnknown;

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

        $t1 = $this->seedWgwGroup('principals/groups/t1', 'T1');
        $t2 = $this->seedWgwGroup('principals/groups/t2', 'T2');
        $this->addPrincipalToGroup($t1, $this->principal('bob'));
        $this->addPrincipalToGroup($t1, $this->principal('dave'));
        $this->addPrincipalToGroup($t2, $this->principal('carol'));

        foreach (['alice', 'bob', 'carol', 'dave'] as $username) {
            app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/'.$username);
        }
        $this->seedDefaultCalendarFor('alice');
    }

    public function test_dm_open_refuses_a_non_colleague_like_an_unknown_user(): void
    {
        $this->asUser('bob')->postJson('/api/v1/chat/dms', ['principal' => 'dave'])->assertOk();

        $open = fn (string $caller, string $target): TestResponse => $this->asUser($caller)
            ->postJson('/api/v1/chat/dms', ['principal' => $target]);

        $this->assertRefusedLikeUnknown($open, 'bob', 'carol', 'ghost');
        $this->assertRefusedLikeUnknown($open, 'alice', 'bob', 'ghost');
        $open('alice', 'bob')->assertStatus(400)
            ->assertJsonPath('error', 'Unknown or invalid DM principal.');
        $carolKinds = array_column((array) $this->asUser('carol')->getJson('/api/v1/chat/channels')->json('list'), 'kind');
        $this->assertNotContains('dm', $carolKinds);
    }

    public function test_calendar_share_refuses_non_colleagues_and_foreign_teams_like_unknown(): void
    {
        $share = fn (string $caller, string $target): TestResponse => $this->jmap($caller, JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => $caller, 'update' => ['default' => [
                'shareWith' => [$target => ['mayReadItems' => true]],
            ]]], 'c0'],
        ]);

        $this->assertEmpty($share('bob', 'dave')->json('methodResponses.0.1.notUpdated'));
        $this->assertEmpty($share('bob', 'groups/t1')->json('methodResponses.0.1.notUpdated'));
        $this->assertRefusedLikeUnknown($share, 'bob', 'carol', 'ghost');
        $this->assertRefusedLikeUnknown($share, 'bob', 'groups/t2', 'groups/nope');
        $this->assertRefusedLikeUnknown($share, 'alice', 'bob', 'ghost');
        $this->assertRefusedLikeUnknown($share, 'alice', 'groups/t1', 'groups/nope');
        $this->assertSame(
            ['type' => 'invalidProperties', 'description' => 'Unknown or invalid share principal.', 'properties' => ['shareWith/carol']],
            $share('bob', 'carol')->json('methodResponses.0.1.notUpdated.default'),
        );
    }

    public function test_task_list_share_refuses_non_colleagues_like_unknown(): void
    {
        $lists = [];
        foreach (['alice', 'bob'] as $owner) {
            $lists[$owner] = (string) $this->asUser($owner)->postJson('/api/v1/tasks/tasklists', ['name' => 'Gate'])
                ->assertCreated()->json('id');
        }
        $share = fn (string $caller, string $target): TestResponse => $this->asUser($caller)
            ->patchJson('/api/v1/tasks/tasklists/'.$lists[$caller], ['shareWith' => [$target => ['mayReadItems' => true]]]);

        $share('bob', 'dave')->assertOk();
        $this->assertRefusedLikeUnknown($share, 'bob', 'carol', 'ghost');
        $this->assertRefusedLikeUnknown($share, 'bob', 'groups/t2', 'groups/nope');
        $this->assertRefusedLikeUnknown($share, 'alice', 'bob', 'ghost');
    }

    public function test_notebook_share_refuses_non_colleagues_like_unknown(): void
    {
        $books = [];
        foreach (['alice', 'bob'] as $owner) {
            $books[$owner] = (string) $this->asUser($owner)->postJson('/api/v1/notes/notebooks', ['name' => 'Gate'])
                ->assertCreated()->json('id');
        }
        $share = fn (string $caller, string $target): TestResponse => $this->asUser($caller)
            ->patchJson('/api/v1/notes/notebooks/'.$books[$caller], ['shareWith' => [$target => ['mayWriteAll' => true]]]);

        $share('bob', 'dave')->assertOk();
        $this->assertRefusedLikeUnknown($share, 'bob', 'carol', 'ghost');
        $this->assertRefusedLikeUnknown($share, 'bob', 'groups/t2', 'groups/nope');
        $this->assertRefusedLikeUnknown($share, 'alice', 'bob', 'ghost');
    }

    public function test_chat_channel_share_refuses_non_colleagues_like_unknown(): void
    {
        $channels = [];
        foreach (['alice', 'bob'] as $owner) {
            $channels[$owner] = (string) $this->asUser($owner)->postJson('/api/v1/chat/channels', [
                'name' => 'Gate', 'kind' => 'channel',
            ])->assertCreated()->json('id');
        }
        $share = fn (string $caller, string $target): TestResponse => $this->asUser($caller)
            ->patchJson('/api/v1/chat/channels/'.$channels[$caller], ['shareWith' => [$target => ['mayWriteAll' => true]]]);

        $share('bob', 'dave')->assertOk();
        $this->assertRefusedLikeUnknown($share, 'bob', 'carol', 'ghost');
        $this->assertRefusedLikeUnknown($share, 'bob', 'groups/t2', 'groups/nope');
        $this->assertRefusedLikeUnknown($share, 'alice', 'bob', 'ghost');
    }

    public function test_address_book_share_refuses_non_colleagues_like_unknown(): void
    {
        $book = AddressBookCollectionUris::PERSONAL_DEFAULT;
        $share = fn (string $caller, string $target): TestResponse => $this->jmap($caller, JmapCapabilities::CONTACTS, [
            ['AddressBook/get', ['accountId' => $caller, 'ids' => [$book]], 'c0'],
            ['AddressBook/set', ['accountId' => $caller, 'update' => [$book => [
                'shareWith' => [$target => ['mayRead' => true]],
            ]]], 'c1'],
        ]);

        $this->assertEmpty($share('bob', 'dave')->json('methodResponses.1.1.notUpdated'));
        $this->assertRefusedLikeUnknown($share, 'bob', 'carol', 'ghost');
        $this->assertRefusedLikeUnknown($share, 'bob', 'groups/t2', 'groups/nope');
        $this->assertRefusedLikeUnknown($share, 'alice', 'bob', 'ghost');
        $this->assertSame(
            ['shareWith/carol'],
            $share('bob', 'carol')->json('methodResponses.1.1.notUpdated.'.$book.'.properties'),
        );
    }

    public function test_address_book_owner_can_revoke_a_former_colleague_by_name(): void
    {
        $book = AddressBookCollectionUris::PERSONAL_DEFAULT;
        $share = fn (?array $grant): TestResponse => $this->jmap('bob', JmapCapabilities::CONTACTS, [
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => [$book]], 'c0'],
            ['AddressBook/set', ['accountId' => 'bob', 'update' => [$book => [
                'shareWith' => ['dave' => $grant],
            ]]], 'c1'],
        ]);
        $this->assertEmpty($share(['mayRead' => true])->json('methodResponses.1.1.notUpdated'));
        $this->assertSame(1, AddressBookShare::query()->where('principaluri', 'principals/dave')->count());

        GroupMember::query()
            ->where('principal_id', Principal::query()->where('uri', 'principals/groups/t1')->value('id'))
            ->where('member_id', $this->principal('dave')->id)
            ->delete();
        $this->app->instance('request', Request::create('/'));

        $this->assertEmpty($share(null)->json('methodResponses.1.1.notUpdated'));
        $this->assertSame(0, AddressBookShare::query()->where('principaluri', 'principals/dave')->count());
    }

    public function test_an_admin_shares_and_opens_dms_inside_their_own_teams(): void
    {
        $this->addPrincipalToGroup(
            Principal::query()->where('uri', 'principals/groups/t2')->firstOrFail(),
            $this->principal('alice'),
        );

        $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'carol'])->assertOk();
        $this->assertEmpty($this->jmap('alice', JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => 'alice', 'update' => ['default' => [
                'shareWith' => ['carol' => ['mayReadItems' => true], 'groups/t2' => ['mayReadItems' => true]],
            ]]], 'c0'],
        ])->json('methodResponses.0.1.notUpdated'));
    }

    public function test_existing_grants_to_a_former_colleague_are_not_touched(): void
    {
        $share = fn (array $shareWith): TestResponse => $this->jmap('bob', JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => 'bob', 'update' => ['default' => ['shareWith' => $shareWith]]], 'c0'],
        ]);
        $this->assertEmpty($share(['dave' => ['mayReadItems' => true]])->json('methodResponses.0.1.notUpdated'));
        $daveInstance = static fn (): ?CalendarInstance => CalendarInstance::query()
            ->where('principaluri', 'principals/dave')
            ->where('share_href', '!=', '')
            ->first();
        $before = $daveInstance()?->getAttributes();
        $this->assertNotNull($before);

        // dave leaves T1: new writes for dave are refused, and his grant stays as it is.
        GroupMember::query()
            ->where('principal_id', Principal::query()->where('uri', 'principals/groups/t1')->value('id'))
            ->where('member_id', $this->principal('dave')->id)
            ->delete();
        $this->app->instance('request', Request::create('/'));
        $rows = CalendarInstance::query()->count();

        foreach ([['dave' => ['mayWriteAll' => true]], ['carol' => ['mayReadItems' => true]]] as $patch) {
            $this->assertNotNull($share($patch)->json('methodResponses.0.1.notUpdated.default'));
        }

        $this->assertSame($rows, CalendarInstance::query()->count());
        $this->assertSame($before, $daveInstance()?->getAttributes());

        // An owner can still take access away from the former colleague, by name.
        $this->assertEmpty($share(['dave' => null])->json('methodResponses.0.1.notUpdated'));
        $this->assertNull($daveInstance());
        $this->assertSame($rows - 1, CalendarInstance::query()->count());
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

    private function principal(string $username): Principal
    {
        $principal = Principal::forUsername($username);
        $this->assertNotNull($principal);

        return $principal;
    }
}
