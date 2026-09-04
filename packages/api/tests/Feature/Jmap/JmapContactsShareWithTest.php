<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\Addressbook;
use App\Models\AddressBookShare;
use App\Models\AddressBookShareDismissal;
use App\Models\Principal;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\AddressBookShareVisibility;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * JMAP AddressBook/set shareWith + card ACL on shared books (Epic #681).
 *
 * CardDAV has no calendarinstances analog — grants live in addressbook_shares.
 * Sharee ids are shared-{addressbookId}. Hide is a per-user dismissal.
 */
final class JmapContactsShareWithTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $this->seedDefaultAddressBookFor('alice');
        Addressbook::query()->where('principaluri', 'principals/bob')->update(['displayname' => 'Bob']);
        Addressbook::query()->where('principaluri', 'principals/alice')->update(['displayname' => 'Alice']);
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
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_owner_can_share_personal_book_read_only(): void
    {
        $response = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['alice' => ['mayRead' => true]],
            ]]], 'c0'],
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => ['default']], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.default'));
        $shareWith = $response->json('methodResponses.1.1.list.0.shareWith');
        $this->assertIsArray($shareWith['alice']);
        $this->assertTrue($shareWith['alice']['mayRead']);
        $this->assertFalse($shareWith['alice']['mayWrite']);
        $this->assertFalse($shareWith['alice']['mayShare']);
        $this->assertTrue($response->json('methodResponses.1.1.list.0.myRights.mayShare'));
        $this->assertFalse($response->json('methodResponses.1.1.list.0.isSharee'));

        $shared = $this->shareeBook('alice');
        $this->assertSame(
            AddressBookCollectionUris::sharedApiId($this->personalBookId('bob')),
            $shared['id'],
        );
        $this->assertNotSame('default', $shared['id']);
        $this->assertNull($shared['shareWith']);
        $this->assertTrue($shared['isSharee']);
        $this->assertFalse($shared['myRights']['mayShare']);
        $this->assertFalse($shared['myRights']['mayWrite']);
        $this->assertTrue($shared['myRights']['mayRead']);
        $this->assertTrue($shared['myRights']['mayDelete']);
        $this->assertFalse($shared['isDefault']);
    }

    public function test_share_grant_rejects_may_share_and_may_delete(): void
    {
        $rejected = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['alice' => ['mayRead' => true, 'mayShare' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('invalidProperties', $rejected['notUpdated']['default']['type']);
        $this->assertContains('shareWith/alice/mayShare', $rejected['notUpdated']['default']['properties']);
        $this->assertNull(
            AddressBookShare::query()
                ->where('principaluri', 'principals/alice')
                ->first(),
        );

        $rejectedDelete = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['alice' => ['mayWrite' => true, 'mayDelete' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('invalidProperties', $rejectedDelete['notUpdated']['default']['type']);
        $this->assertContains('shareWith/alice/mayDelete', $rejectedDelete['notUpdated']['default']['properties']);
    }

    public function test_read_share_denies_card_create_update_and_delete(): void
    {
        $this->shareBook('bob', 'default', 'alice', write: false);
        $sharedId = (string) $this->shareeBook('alice')['id'];

        $ownerCardId = (string) $this->jmapAs('bob', [
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['e' => $this->sampleContactCardPayload('default')]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.e.id');

        $viewed = $this->jmapAs('alice', [
            ['ContactCard/get', ['accountId' => 'alice', 'ids' => [$ownerCardId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$sharedId => true], $viewed['list'][0]['addressBookIds'] ?? null);

        $denied = $this->jmapAs('alice', [
            ['ContactCard/set', [
                'accountId' => 'alice',
                'create' => ['new' => $this->sampleContactCardPayload($sharedId)],
                'update' => [$ownerCardId => ['name' => ['full' => 'Hijacked']]],
                'destroy' => [$ownerCardId],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('forbidden', $denied['notCreated']['new']['type']);
        $this->assertSame('forbidden', $denied['notUpdated'][$ownerCardId]['type']);
        $this->assertSame('forbidden', $denied['notDestroyed'][$ownerCardId]['type']);
        $this->assertSame([], $denied['created']);
        $this->assertSame([], $denied['updated']);
        $this->assertSame([], $denied['destroyed']);
    }

    public function test_write_share_allows_card_create_update_and_delete(): void
    {
        $this->shareBook('bob', 'default', 'alice', write: true);
        $sharedId = (string) $this->shareeBook('alice')['id'];

        $created = $this->jmapAs('alice', [
            ['ContactCard/set', ['accountId' => 'alice', 'create' => ['e' => $this->sampleContactCardPayload($sharedId)]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $cardId = (string) $created['created']['e']['id'];
        $this->assertNotSame('', $cardId);
        $this->assertArrayNotHasKey('e', $created['notCreated']);
        $viewed = $this->jmapAs('alice', [
            ['ContactCard/get', ['accountId' => 'alice', 'ids' => [$cardId]], 'c1'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame([$sharedId => true], $viewed['addressBookIds'] ?? null);

        $updated = $this->jmapAs('alice', [
            ['ContactCard/set', ['accountId' => 'alice', 'update' => [$cardId => [
                'name' => ['full' => 'Alice card edited'],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertArrayHasKey($cardId, $updated['updated']);
        $this->assertArrayNotHasKey($cardId, $updated['notUpdated']);

        $destroyed = $this->jmapAs('alice', [
            ['ContactCard/set', ['accountId' => 'alice', 'destroy' => [$cardId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$cardId], $destroyed['destroyed']);
    }

    public function test_owner_can_change_permission_and_revoke(): void
    {
        $this->shareBook('bob', 'default', 'alice', write: false);

        $promoted = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['alice' => ['mayWrite' => true]],
            ]]], 'c0'],
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => ['default']], 'c1'],
        ])->assertOk();
        $this->assertTrue($promoted->json('methodResponses.1.1.list.0.shareWith.alice.mayWrite'));
        $this->assertTrue($this->shareeBook('alice')['myRights']['mayWrite']);

        $revoked = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['alice' => null],
            ]]], 'c0'],
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => ['default']], 'c1'],
        ])->assertOk();
        $this->assertNull($revoked->json('methodResponses.1.1.list.0.shareWith'));

        $aliceNames = array_column($this->jmapAs('alice', [
            ['AddressBook/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Bob', $aliceNames);
    }

    public function test_revoke_reports_address_book_destroyed_on_sharee_changes(): void
    {
        $before = $this->jmapAs('alice', [
            ['AddressBook/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $this->shareBook('bob', 'default', 'alice', write: false);
        $sharedId = (string) $this->shareeBook('alice')['id'];
        $afterShare = $this->jmapAs('alice', [
            ['AddressBook/changes', ['accountId' => 'alice', 'sinceState' => $before], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($sharedId, $afterShare['created']);

        $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['alice' => null],
            ]]], 'c0'],
        ])->assertOk();

        $afterRevoke = $this->jmapAs('alice', [
            ['AddressBook/changes', ['accountId' => 'alice', 'sinceState' => $afterShare['newState']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($sharedId, $afterRevoke['destroyed']);
    }

    public function test_sharee_can_dismiss_shared_book_without_revoking_owner_grant(): void
    {
        $this->shareBook('bob', 'default', 'alice', write: false);
        $shared = $this->shareeBook('alice');
        $sharedId = (string) $shared['id'];
        $this->assertTrue($shared['myRights']['mayDelete']);
        $bookPk = $this->personalBookId('bob');

        $destroyed = $this->jmapAs('alice', [
            ['AddressBook/set', ['accountId' => 'alice', 'destroy' => [$sharedId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$sharedId], $destroyed['destroyed']);
        $this->assertTrue(
            AddressBookShareDismissal::query()->where('username', 'alice')->where('addressbookid', $bookPk)->exists(),
            'Expected a share dismissal for alice',
        );

        $aliceNames = array_column($this->jmapAs('alice', [
            ['AddressBook/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Bob', $aliceNames);

        $owner = $this->jmapAs('bob', [
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => ['default']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame(AddressBookCollectionUris::PERSONAL_DISPLAY_NAME, $owner['name']);
        $this->assertIsArray($owner['shareWith']['alice']);

        app(AddressBookShareVisibility::class)->restore('alice', $bookPk);
        $this->assertSame(AddressBookCollectionUris::PERSONAL_DISPLAY_NAME, $this->shareeBook('alice')['name']);
    }

    public function test_sharee_is_subscribed_false_dismisses_without_revoking_owner_grant(): void
    {
        $this->shareBook('bob', 'default', 'alice', write: false);
        $sharedId = (string) $this->shareeBook('alice')['id'];

        $this->jmapAs('alice', [
            ['AddressBook/set', ['accountId' => 'alice', 'update' => [$sharedId => [
                'isSubscribed' => false,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertTrue(
            AddressBookShareDismissal::query()->where('username', 'alice')->exists(),
        );
        $aliceNames = array_column($this->jmapAs('alice', [
            ['AddressBook/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Bob', $aliceNames);
        $this->assertIsArray(
            $this->jmapAs('bob', [
                ['AddressBook/get', ['accountId' => 'bob', 'ids' => ['default']], 'c0'],
            ])->assertOk()->json('methodResponses.0.1.list.0.shareWith.alice'),
        );
    }

    public function test_sharee_cannot_change_owner_fields(): void
    {
        $this->shareBook('bob', 'default', 'alice', write: true);
        $sharedId = (string) $this->shareeBook('alice')['id'];

        $patched = $this->jmapAs('alice', [
            ['AddressBook/set', ['accountId' => 'alice', 'update' => [$sharedId => [
                'description' => 'Hijacked',
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('forbidden', $patched['notUpdated'][$sharedId]['type']);

        $shareeShare = $this->jmapAs('alice', [
            ['AddressBook/set', ['accountId' => 'alice', 'update' => [$sharedId => [
                'shareWith' => ['carol' => ['mayRead' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('forbidden', $shareeShare['notUpdated'][$sharedId]['type']);
    }

    public function test_owner_can_share_personal_book_with_a_group(): void
    {
        $response = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['groups/'.self::TEAM => ['mayWrite' => true]],
            ]]], 'c0'],
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => ['default']], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.default'));
        $grant = $response->json('methodResponses.1.1.list.0.shareWith.groups/'.self::TEAM);
        $this->assertIsArray($grant);
        $this->assertTrue($grant['mayWrite']);

        $bobNames = array_column($this->jmapAs('bob', [
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertSame(1, count(array_filter($bobNames, static fn (string $name): bool => $name === AddressBookCollectionUris::PERSONAL_DISPLAY_NAME)));
        $owned = $this->bookNamed('bob', AddressBookCollectionUris::PERSONAL_DISPLAY_NAME);
        $this->assertSame('default', $owned['id']);
        $this->assertTrue($owned['myRights']['mayShare']);
        $this->assertFalse($owned['isSharee']);

        $alice = Principal::forUsername('alice');
        $team = Principal::query()->where('uri', 'principals/groups/'.self::TEAM)->first();
        $this->assertNotNull($alice);
        $this->assertNotNull($team);
        $this->addPrincipalToGroup($team, $alice);
        $shared = $this->shareeBook('alice');
        $this->assertNotSame('default', $shared['id']);
        $this->assertTrue($shared['isSharee']);
        $this->assertTrue($shared['myRights']['mayWrite']);
        $this->assertNull($shared['shareWith']);

        $carolIds = array_column($this->jmapAs('carol', [
            ['AddressBook/get', ['accountId' => 'carol', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Bob', $carolIds);
    }

    public function test_sharing_personal_book_with_own_group_does_not_list_it_twice(): void
    {
        $this->shareBook('bob', 'default', 'groups/'.self::TEAM, write: false);

        $homes = array_values(array_filter(
            $this->jmapAs('bob', [
                ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ])->assertOk()->json('methodResponses.0.1.list'),
            static fn (array $row): bool => $row['name'] === AddressBookCollectionUris::PERSONAL_DISPLAY_NAME,
        ));
        $this->assertCount(1, $homes);
        $this->assertSame('default', $homes[0]['id']);
        $this->assertFalse($homes[0]['isSharee']);
        $this->assertTrue($homes[0]['myRights']['mayShare']);
        $this->assertTrue($homes[0]['myRights']['mayWrite']);
    }

    public function test_non_owner_cannot_share(): void
    {
        $this->shareBook('bob', 'default', 'alice', write: true);
        $sharedId = (string) $this->shareeBook('alice')['id'];

        $sharee = $this->jmapAs('alice', [
            ['AddressBook/set', ['accountId' => 'alice', 'update' => [$sharedId => [
                'shareWith' => ['carol' => ['mayRead' => true]],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('forbidden', $sharee['notUpdated'][$sharedId]['type']);

        $outsiderBob = $this->jmapAs('carol', [
            ['AddressBook/set', ['accountId' => 'carol', 'update' => [
                AddressBookCollectionUris::sharedApiId($this->personalBookId('bob')) => [
                    'shareWith' => ['alice' => ['mayRead' => true]],
                ],
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $sharedBobId = AddressBookCollectionUris::sharedApiId($this->personalBookId('bob'));
        $this->assertSame('notFound', $outsiderBob['notUpdated'][$sharedBobId]['type']);
    }

    public function test_group_member_can_share_group_book(): void
    {
        $bookId = AddressBookCollectionUris::groupApiId(self::TEAM);

        $response = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => [$bookId => [
                'shareWith' => ['alice' => ['mayRead' => true]],
            ]]], 'c0'],
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => [$bookId]], 'c1'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.'.$bookId));
        $grant = $response->json('methodResponses.1.1.list.0.shareWith.alice');
        $this->assertIsArray($grant);
        $this->assertTrue($grant['mayRead']);
        $this->assertFalse($grant['mayWrite']);
        $this->assertTrue($response->json('methodResponses.1.1.list.0.myRights.mayShare'));
        $this->assertFalse($response->json('methodResponses.1.1.list.0.isSharee'));

        $shared = $this->bookNamed('alice', 'Team');
        $this->assertTrue($shared['isSharee']);
        $this->assertNull($shared['shareWith']);
        $this->assertFalse($shared['myRights']['mayShare']);
        $this->assertFalse($shared['myRights']['mayWrite']);
        $this->assertTrue($shared['myRights']['mayRead']);
    }

    public function test_leave_group_drops_group_grantee_share(): void
    {
        $this->shareBook('bob', 'default', 'groups/'.self::TEAM, write: true);
        $alice = Principal::forUsername('alice');
        $team = Principal::query()->where('uri', 'principals/groups/'.self::TEAM)->first();
        $this->assertNotNull($alice);
        $this->assertNotNull($team);
        $this->addPrincipalToGroup($team, $alice);
        $this->assertTrue($this->shareeBook('alice')['isSharee']);

        $this->withBearer($this->adminBearerToken())
            ->deleteJson('/api/v1/admin/groups/'.self::TEAM.'/members/alice')
            ->assertOk();

        $aliceNames = array_column($this->jmapAs('alice', [
            ['AddressBook/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Bob', $aliceNames);

        $owner = $this->jmapAs('bob', [
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => ['default']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertIsArray($owner['shareWith']['groups/'.self::TEAM] ?? null);
    }

    public function test_delete_group_drops_grants_from_book_and_to_group(): void
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

        $groupBookId = AddressBookCollectionUris::groupApiId('studio');
        $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => [$groupBookId => [
                'shareWith' => ['alice' => ['mayRead' => true]],
            ]]], 'c0'],
        ])->assertOk();
        $this->shareBook('bob', 'default', 'groups/studio', write: false);

        $studioBook = Addressbook::query()->where('principaluri', 'principals/groups/studio')->first();
        $this->assertNotNull($studioBook);
        $this->assertTrue(
            AddressBookShare::query()->where('addressbookid', (int) $studioBook->id)->exists(),
        );
        $this->assertTrue(
            AddressBookShare::query()->where('principaluri', 'principals/groups/studio')->exists(),
        );

        $this->withBearer($this->adminBearerToken())
            ->deleteJson('/api/v1/admin/groups/studio')
            ->assertOk();

        $this->assertSame(
            0,
            AddressBookShare::query()->where('addressbookid', (int) $studioBook->id)->count(),
        );
        $this->assertSame(
            0,
            AddressBookShare::query()->where('principaluri', 'principals/groups/studio')->count(),
        );

        $aliceNames = array_column($this->jmapAs('alice', [
            ['AddressBook/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'), 'name');
        $this->assertNotContains('Studio', $aliceNames);
        $this->assertNotContains('Bob', $aliceNames);
    }

    public function test_read_group_share_cannot_write_cards(): void
    {
        $this->shareBook('bob', 'default', 'groups/'.self::TEAM, write: false);
        $alice = Principal::forUsername('alice');
        $team = Principal::query()->where('uri', 'principals/groups/'.self::TEAM)->first();
        $this->assertNotNull($alice);
        $this->assertNotNull($team);
        $this->addPrincipalToGroup($team, $alice);

        $sharedId = (string) $this->shareeBook('alice')['id'];
        $this->assertFalse($this->shareeBook('alice')['myRights']['mayWrite']);

        $denied = $this->jmapAs('alice', [
            ['ContactCard/set', ['accountId' => 'alice', 'create' => ['new' => $this->sampleContactCardPayload($sharedId)]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame('forbidden', $denied['notCreated']['new']['type']);
    }

    private function shareBook(string $owner, string $bookId, string $sharee, bool $write): void
    {
        $rights = $write
            ? ['mayWrite' => true]
            : ['mayRead' => true];

        $args = $this->jmapAs($owner, [
            ['AddressBook/set', ['accountId' => $owner, 'update' => [$bookId => [
                'shareWith' => [$sharee => $rights],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertNull($args['notUpdated'][$bookId] ?? null);
    }

    /**
     * @return array<string, mixed>
     */
    private function bookNamed(string $username, string $name): array
    {
        $list = $this->jmapAs($username, [
            ['AddressBook/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $book = collect($list)->first(
            static fn (array $row): bool => $row['name'] === $name
        );
        $this->assertIsArray($book, "Expected {$username} to see address book {$name}");

        return $book;
    }

    /**
     * @return array<string, mixed>
     */
    private function shareeBook(string $username): array
    {
        $list = $this->jmapAs($username, [
            ['AddressBook/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $book = collect($list)->first(
            static fn (array $row): bool => ($row['isSharee'] ?? false) === true
        );
        $this->assertIsArray($book, "Expected {$username} to see a shared address book");

        return $book;
    }

    private function personalBookId(string $username): int
    {
        $id = Addressbook::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('uri', AddressBookCollectionUris::CALDAV_URI)
            ->value('id');
        $this->assertNotNull($id);

        return (int) $id;
    }
}
