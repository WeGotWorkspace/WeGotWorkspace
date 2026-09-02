<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\Addressbook;
use App\Models\Card;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\ContactCardMapper;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * ContactCard/set addressBookIds move must change cards.addressbookid and
 * report the destination book (Epic #681).
 */
final class JmapContactsCardMoveTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $this->seedDefaultAddressBookFor('alice');
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

    public function test_address_book_ids_patch_moves_card_to_destination_book(): void
    {
        $groupId = $this->joinStudioGroup('bob');
        $cardId = $this->jmapCreateContactCard($this->sampleContactCardPayload());
        $before = $this->jmapAs('bob', [
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => [$cardId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $moved = $this->jmapAs('bob', [
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$cardId => [
                'addressBookIds' => ['default' => false, $groupId => true],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertArrayHasKey($cardId, $moved['updated']);
        $this->assertArrayNotHasKey($cardId, $moved['notUpdated']);

        $card = Card::query()->where('uri', ContactCardMapper::cardUriFromId($cardId))->first();
        $this->assertNotNull($card);
        $this->assertSame($this->bookNumericId('principals/groups/studio'), (int) $card->addressbookid);

        $got = $this->jmapGetContactCard($cardId);
        $this->assertSame([$groupId => true], $got['addressBookIds']);

        $sourceQuery = $this->jmapAs('bob', [
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['inAddressBook' => 'default']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $destQuery = $this->jmapAs('bob', [
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['inAddressBook' => $groupId]], 'c1'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $this->assertNotContains($cardId, $sourceQuery);
        $this->assertContains($cardId, $destQuery);

        $changes = $this->jmapAs('bob', [
            ['ContactCard/changes', ['accountId' => 'bob', 'sinceState' => $before], 'c2'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($cardId, $changes['created']);
        $this->assertNotContains($cardId, $changes['destroyed']);
    }

    public function test_move_drops_source_book_group_memberships(): void
    {
        $groupId = $this->joinStudioGroup('bob');
        $cardId = $this->jmapCreateContactCard($this->sampleContactCardPayload());
        $uid = (string) $this->jmapGetContactCard($cardId)['uid'];

        $friendsId = $this->jmapCreateContactCard([
            'addressBookIds' => ['default' => true],
            'kind' => 'group',
            'name' => ['full' => 'Friends'],
            'members' => [$uid => true],
        ]);
        $this->assertArrayHasKey($uid, $this->jmapGetContactCard($friendsId)['members'] ?? []);

        $this->jmapAs('bob', [
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$cardId => [
                'addressBookIds' => ['default' => false, $groupId => true],
            ]]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.notUpdated.'.$cardId, null);

        $friends = $this->jmapGetContactCard($friendsId);
        $enabledMembers = array_filter(
            is_array($friends['members'] ?? null) ? $friends['members'] : [],
            static fn ($enabled): bool => $enabled === true,
        );
        $this->assertArrayNotHasKey($uid, $enabledMembers);
        $this->assertSame([$groupId => true], $this->jmapGetContactCard($cardId)['addressBookIds']);
    }

    public function test_move_into_read_only_share_is_forbidden_and_leaves_card_in_source(): void
    {
        $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['alice' => ['mayRead' => true]],
            ]]], 'c0'],
        ])->assertOk();

        $sharedId = AddressBookCollectionUris::sharedApiId($this->bookNumericId('principals/bob'));
        $cardId = $this->jmapCreateContactCard(
            $this->sampleContactCardPayload(),
            'alice',
            $this->issueBearerTokenFor('alice'),
        );
        $sourceBookId = $this->bookNumericId('principals/alice');

        $denied = $this->jmapAs('alice', [
            ['ContactCard/set', ['accountId' => 'alice', 'update' => [$cardId => [
                'addressBookIds' => ['default' => false, $sharedId => true],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('forbidden', $denied['notUpdated'][$cardId]['type']);
        $this->assertArrayNotHasKey($cardId, $denied['updated']);

        $card = Card::query()->where('uri', ContactCardMapper::cardUriFromId($cardId))->first();
        $this->assertNotNull($card);
        $this->assertSame($sourceBookId, (int) $card->addressbookid);
        $this->assertSame(
            ['default' => true],
            $this->jmapGetContactCard($cardId, 'alice', $this->issueBearerTokenFor('alice'))['addressBookIds'],
        );
    }

    private function joinStudioGroup(string $username): string
    {
        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/groups', [
                'name' => 'studio',
                'displayName' => 'Studio',
            ])
            ->assertOk();
        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/groups/studio/members/'.$username)
            ->assertOk();

        return AddressBookCollectionUris::groupApiId('studio');
    }

    private function bookNumericId(string $principalUri): int
    {
        $id = Addressbook::query()
            ->where('principaluri', $principalUri)
            ->where('uri', AddressBookCollectionUris::CALDAV_URI)
            ->value('id');
        $this->assertNotNull($id);

        return (int) $id;
    }
}
