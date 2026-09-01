<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\Addressbook;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Card;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CardDAV\Backend\PDO as CardPDO;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * One book per principal, eager+lazy provision, join/leave,
 * create/rename/delete lock, and group-delete DAV cascade.
 */
final class JmapContactsProvisionTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
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
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_session_may_create_address_book_is_false(): void
    {
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();

        $contacts = $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::CONTACTS];
        $this->assertFalse($contacts['mayCreateAddressBook']);
    }

    public function test_eager_provision_on_new_user_create(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/users', [
                'username' => 'dave',
                'password' => 'dave-secret12',
                'displayName' => 'Dave',
                'email' => 'dave@example.test',
                'groups' => [],
            ])
            ->assertOk();

        $this->assertDatabaseHas('addressbooks', [
            'principaluri' => 'principals/dave',
            'uri' => AddressBookCollectionUris::CALDAV_URI,
            'displayname' => AddressBookCollectionUris::PERSONAL_DISPLAY_NAME,
        ], 'wgw');

        $daveToken = $this->issueBearerTokenFor('dave', 'dave-secret12');
        $args = $this->withBearer($daveToken)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => [
                ['AddressBook/get', ['accountId' => 'dave', 'ids' => null], 'c0'],
            ],
        ])->assertOk()->json('methodResponses.0.1');

        $default = collect($args['list'])->firstWhere('id', 'default');
        $this->assertIsArray($default);
        $this->assertSame(AddressBookCollectionUris::PERSONAL_DISPLAY_NAME, $default['name']);
        $this->assertFalse($default['myRights']['mayDelete']);
    }

    public function test_eager_provision_on_new_group_create(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/groups', [
                'name' => 'studio',
                'displayName' => 'Studio',
            ])
            ->assertOk();

        $this->assertDatabaseHas('addressbooks', [
            'principaluri' => 'principals/groups/studio',
            'uri' => AddressBookCollectionUris::CALDAV_URI,
            'displayname' => 'Studio',
        ], 'wgw');
    }

    public function test_lazy_ensure_provisions_missing_personal_book(): void
    {
        $this->seedWgwUser('erin', displayName: 'Erin');

        $this->assertDatabaseMissing('addressbooks', [
            'principaluri' => 'principals/erin',
        ], 'wgw');

        $args = $this->jmapAs('erin', [
            ['AddressBook/get', ['accountId' => 'erin', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $default = collect($args['list'])->firstWhere('id', 'default');
        $this->assertIsArray($default);
        $this->assertSame(AddressBookCollectionUris::PERSONAL_DISPLAY_NAME, $default['name']);
        $this->assertDatabaseHas('addressbooks', [
            'principaluri' => 'principals/erin',
            'uri' => AddressBookCollectionUris::CALDAV_URI,
            'displayname' => AddressBookCollectionUris::PERSONAL_DISPLAY_NAME,
        ], 'wgw');
    }

    public function test_list_rewrites_existing_user_book_displayname_to_personal(): void
    {
        $this->seedWgwUser('erin', displayName: 'Erin');
        $this->seedDefaultAddressBookFor('erin');
        Addressbook::query()->where('principaluri', 'principals/erin')->update(['displayname' => 'Erin']);

        $this->assertDatabaseHas('addressbooks', [
            'principaluri' => 'principals/erin',
            'uri' => AddressBookCollectionUris::CALDAV_URI,
            'displayname' => 'Erin',
        ], 'wgw');

        $args = $this->jmapAs('erin', [
            ['AddressBook/get', ['accountId' => 'erin', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $default = collect($args['list'])->firstWhere('id', 'default');
        $this->assertIsArray($default);
        $this->assertSame(AddressBookCollectionUris::PERSONAL_DISPLAY_NAME, $default['name']);
        $this->assertDatabaseHas('addressbooks', [
            'principaluri' => 'principals/erin',
            'uri' => AddressBookCollectionUris::CALDAV_URI,
            'displayname' => AddressBookCollectionUris::PERSONAL_DISPLAY_NAME,
        ], 'wgw');
    }

    public function test_join_and_leave_group_toggles_membership_book(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/groups', [
                'name' => 'studio',
                'displayName' => 'Studio',
            ])
            ->assertOk();

        $groupId = AddressBookCollectionUris::groupApiId('studio');

        $before = $this->jmapAs('bob', [
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertNotContains($groupId, array_column($before['list'], 'id'));

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/groups/studio/members/bob')
            ->assertOk();

        $joined = $this->jmapAs('bob', [
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
        ])->assertOk()->json('methodResponses.0.1');
        $groupBook = collect($joined['list'])->firstWhere('id', $groupId);
        $this->assertIsArray($groupBook);
        $this->assertSame('Studio', $groupBook['name']);
        $this->assertFalse($groupBook['isDefault']);
        $this->assertFalse($groupBook['myRights']['mayDelete']);

        $this->withBearer($this->adminBearerToken())
            ->deleteJson('/api/v1/admin/groups/studio/members/bob')
            ->assertOk();

        $left = $this->jmapAs('bob', [
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c2'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertNotContains($groupId, array_column($left['list'], 'id'));
    }

    public function test_non_member_get_omits_group_book_and_card_create_is_forbidden(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/groups', [
                'name' => 'studio',
                'displayName' => 'Studio',
            ])
            ->assertOk();

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/groups/studio/members/bob')
            ->assertOk();

        $groupId = AddressBookCollectionUris::groupApiId('studio');

        $carolList = $this->jmapAs('carol', [
            ['AddressBook/get', ['accountId' => 'carol', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertNotContains($groupId, array_column($carolList['list'], 'id'));

        $carolGet = $this->jmapAs('carol', [
            ['AddressBook/get', ['accountId' => 'carol', 'ids' => [$groupId]], 'c1'],
        ])->assertOk();
        $this->assertSame([$groupId], $carolGet->json('methodResponses.0.1.notFound'));

        $create = $this->jmapAs('carol', [
            ['ContactCard/set', ['accountId' => 'carol', 'create' => ['k0' => $this->sampleContactCardPayload($groupId)]], 'c2'],
        ])->assertOk();
        $create->assertJsonPath('methodResponses.0.1.notCreated.k0.type', 'forbidden');
    }

    public function test_member_can_create_card_in_group_book(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/groups', [
                'name' => 'studio',
                'displayName' => 'Studio',
            ])
            ->assertOk();
        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/groups/studio/members/bob')
            ->assertOk();

        $groupId = AddressBookCollectionUris::groupApiId('studio');
        $cardId = $this->jmapAs('bob', [
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => $this->sampleContactCardPayload($groupId)]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.k0.id');
        $this->assertIsString($cardId);

        $card = $this->jmapAs('bob', [
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => [$cardId]], 'c1'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame([$groupId => true], $card['addressBookIds']);
    }

    public function test_create_rename_and_delete_address_book_are_forbidden(): void
    {
        $create = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'create' => ['b0' => ['name' => 'Team']]], 'c0'],
        ])->assertOk();
        $create->assertJsonPath('methodResponses.0.1.notCreated.b0.type', 'forbidden');

        $rename = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => ['name' => 'Renamed']]], 'c1'],
        ])->assertOk();
        $rename->assertJsonPath('methodResponses.0.1.notUpdated.default.type', 'forbidden');

        $destroy = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'destroy' => ['default']], 'c2'],
        ])->assertOk();
        $destroy->assertJsonPath('methodResponses.0.1.notDestroyed.default.type', 'forbidden');
    }

    public function test_group_delete_cascades_carddav_and_caldav_rows_including_vjournal(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/groups', [
                'name' => 'studio',
                'displayName' => 'Studio',
            ])
            ->assertOk();

        $principalUri = 'principals/groups/studio';
        $this->seedGroupDavObjects($principalUri, 'studio');

        $book = Addressbook::query()->where('principaluri', $principalUri)->first();
        $this->assertNotNull($book);
        $this->assertTrue($book->cards()->exists());

        $calendarIds = CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->pluck('calendarid')
            ->all();
        $this->assertNotSame([], $calendarIds);
        $this->assertGreaterThan(0, CalendarObject::query()->whereIn('calendarid', $calendarIds)->where('componenttype', 'VEVENT')->count());
        $this->assertGreaterThan(0, CalendarObject::query()->whereIn('calendarid', $calendarIds)->where('componenttype', 'VTODO')->count());
        $this->assertGreaterThan(0, CalendarObject::query()->whereIn('calendarid', $calendarIds)->where('componenttype', 'VJOURNAL')->count());

        $this->withBearer($this->adminBearerToken())
            ->deleteJson('/api/v1/admin/groups/studio')
            ->assertOk();

        $this->assertSame(0, Addressbook::query()->where('principaluri', $principalUri)->count());
        $this->assertSame(0, Card::query()->where('addressbookid', (int) $book->id)->count());
        $this->assertSame(0, CalendarInstance::query()->where('principaluri', $principalUri)->count());
        $this->assertSame(0, CalendarObject::query()->whereIn('calendarid', $calendarIds)->where('componenttype', 'VEVENT')->count());
        $this->assertSame(0, CalendarObject::query()->whereIn('calendarid', $calendarIds)->where('componenttype', 'VTODO')->count());
        $this->assertSame(
            0,
            CalendarObject::query()->whereIn('calendarid', $calendarIds)->where('componenttype', 'VJOURNAL')->count(),
            'Notes assertion is VJOURNAL calendar rows, not a .notes path.',
        );
        $this->assertNull(Principal::query()->where('uri', $principalUri)->first());
    }

    public function test_lazy_ensure_provisions_missing_group_book_on_member_list(): void
    {
        $group = $this->seedWgwGroup('principals/groups/orphans', 'Orphans');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($group, $bob);

        $this->assertDatabaseMissing('addressbooks', [
            'principaluri' => 'principals/groups/orphans',
        ], 'wgw');

        $args = $this->jmapAs('bob', [
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $groupBook = collect($args['list'])->firstWhere('id', AddressBookCollectionUris::groupApiId('orphans'));
        $this->assertIsArray($groupBook);
        $this->assertSame('Orphans', $groupBook['name']);
    }

    private function seedGroupDavObjects(string $principalUri, string $slug): void
    {
        $pdo = DB::connection('wgw')->getPdo();
        $caldav = new CalPDO($pdo);
        foreach ($caldav->getCalendarsForUser($principalUri) as $cal) {
            $uri = (string) ($cal['uri'] ?? '');
            $id = $cal['id'] ?? null;
            if (! is_array($id)) {
                continue;
            }
            if ($uri === CalendarCollectionUris::groupCalendarCalDavUri($slug)) {
                $caldav->createCalendarObject($id, 'event.ics', $this->sampleEventIcs());
            }
            if ($uri === CalendarCollectionUris::groupTaskListCalDavUri($slug)) {
                $caldav->createCalendarObject($id, 'task.ics', $this->sampleTodoIcs());
            }
            if ($uri === CalendarCollectionUris::groupNotebookCalDavUri($slug)) {
                $caldav->createCalendarObject($id, 'note.ics', $this->sampleJournalIcs());
            }
        }

        $carddav = new CardPDO($pdo);
        foreach ($carddav->getAddressBooksForUser($principalUri) as $book) {
            if (($book['uri'] ?? '') === AddressBookCollectionUris::CALDAV_URI && isset($book['id'])) {
                $carddav->createCard((int) $book['id'], 'lead.vcf', $this->sampleVcard('Studio Lead'));
            }
        }
    }

    private function sampleEventIcs(): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:studio-event\r\nDTSTAMP:20260831T120000Z\r\nDTSTART:20260901T100000Z\r\nDTEND:20260901T110000Z\r\nSUMMARY:Standup\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function sampleTodoIcs(): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:studio-task\r\nDTSTAMP:20260831T120000Z\r\nSUMMARY:Ship roster\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
    }

    private function sampleJournalIcs(): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VJOURNAL\r\nUID:studio-note\r\nDTSTAMP:20260831T120000Z\r\nSUMMARY:Kickoff notes\r\nDESCRIPTION:Canonical Notes store is VJOURNAL.\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n";
    }
}
