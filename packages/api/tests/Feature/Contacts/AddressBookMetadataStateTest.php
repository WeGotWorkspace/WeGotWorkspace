<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Models\Addressbook;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\AddressBookProvisioner;
use Illuminate\Testing\TestResponse;
use Tests\Support\CollectionMetadataStateAssertions;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Changing an address book's name or description moves the AddressBook state
 * of everyone who can see it, from the app and from a DAV client alike
 * (#1671). The app cannot rename address books (the personal one is always
 * "Personal"), so its only metadata write is the description; DAV clients can
 * PROPPATCH the name.
 */
final class AddressBookMetadataStateTest extends WgwDatabaseTestCase
{
    use CollectionMetadataStateAssertions;
    use ContactsTestFixtures;

    private const CARDDAV_DESCRIPTION = '{urn:ietf:params:xml:ns:carddav}addressbook-description';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $this->setUpDavServer();
    }

    public function test_description_change_in_the_app_moves_state_for_owner_and_sharee(): void
    {
        $shareeId = $this->shareBobsBookWithAlice();
        $before = $this->states();

        $set = $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => ['description' => 'Clients and suppliers']]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertArrayHasKey('default', $set['updated']);
        $this->assertNotSame($set['oldState'], $set['newState']);

        $this->assertCollectionUpdated($this->changes('bob', $before['bob']), $before['bob'], 'default', 'bob');
        $this->assertCollectionUpdated($this->changes('alice', $before['alice']), $before['alice'], $shareeId, 'alice');
        $this->assertSame('Clients and suppliers', $this->book('alice', $shareeId)['description']);
        $this->assertNoCardChanges('bob', $before['bob']);
        $this->assertNoCardChanges('alice', $before['alice']);
    }

    public function test_dav_proppatch_rename_moves_state_for_owner_and_sharee(): void
    {
        $shareeId = $this->shareBobsBookWithAlice();
        $before = $this->states();

        $this->davProppatch('bob', '/addressbooks/bob/'.AddressBookCollectionUris::CALDAV_URI, [
            '{DAV:}displayname' => 'Work contacts',
            self::CARDDAV_DESCRIPTION => 'From my phone',
        ]);

        $this->assertCollectionUpdated($this->changes('bob', $before['bob']), $before['bob'], 'default', 'bob');
        $this->assertCollectionUpdated($this->changes('alice', $before['alice']), $before['alice'], $shareeId, 'alice');
        $this->assertSame('From my phone', $this->book('alice', $shareeId)['description']);
        $this->assertNoCardChanges('bob', $before['bob']);
        $this->assertNoCardChanges('alice', $before['alice']);
    }

    public function test_putting_the_personal_name_back_moves_state_for_the_sharee(): void
    {
        $shareeId = $this->shareBobsBookWithAlice();
        $this->davProppatch('bob', '/addressbooks/bob/'.AddressBookCollectionUris::CALDAV_URI, [
            '{DAV:}displayname' => 'Work contacts',
        ]);
        $aliceState = $this->state('alice');
        $book = Addressbook::query()
            ->where('principaluri', 'principals/bob')
            ->where('uri', AddressBookCollectionUris::CALDAV_URI)
            ->firstOrFail();
        $this->assertSame('Work contacts', (string) $book->displayname, 'precondition: the DAV name is still stored');

        app(AddressBookProvisioner::class)->ensureForPrincipal('principals/bob', 'Bob');

        $book->refresh();
        $this->assertSame(AddressBookCollectionUris::PERSONAL_DISPLAY_NAME, (string) $book->displayname);
        $this->assertCollectionUpdated($this->changes('alice', $aliceState), $aliceState, $shareeId, 'alice');
        $this->assertSame(AddressBookCollectionUris::PERSONAL_DISPLAY_NAME, $this->book('alice', $shareeId)['name']);
    }

    private function shareBobsBookWithAlice(): string
    {
        $this->jmapAs('bob', [
            ['AddressBook/set', ['accountId' => 'bob', 'update' => ['default' => [
                'shareWith' => ['alice' => ['mayRead' => true]],
            ]]], 'c0'],
        ])->assertOk();

        $shared = collect($this->jmapAs('alice', [
            ['AddressBook/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list'))
            ->first(static fn (array $book): bool => ($book['isSharee'] ?? false) === true);
        $this->assertIsArray($shared, 'alice must see bob\'s address book');

        return (string) $shared['id'];
    }

    /** @return array{bob: string, alice: string} */
    private function states(): array
    {
        return ['bob' => $this->state('bob'), 'alice' => $this->state('alice')];
    }

    private function state(string $username): string
    {
        return (string) $this->jmapAs($username, [
            ['AddressBook/get', ['accountId' => $username, 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');
    }

    /** @return array<string, mixed> */
    private function changes(string $username, string $since): array
    {
        return $this->jmapAs($username, [
            ['AddressBook/changes', ['accountId' => $username, 'sinceState' => $since], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
    }

    /** @return array<string, mixed> */
    private function book(string $username, string $id): array
    {
        $book = $this->jmapAs($username, [
            ['AddressBook/get', ['accountId' => $username, 'ids' => [$id]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertIsArray($book, $username.' must see address book '.$id);

        return $book;
    }

    /**
     * A metadata change touches no card, so ContactCard/changes over the same
     * window reports none (Sabre logs the book change under an empty uri).
     */
    private function assertNoCardChanges(string $username, string $since): void
    {
        $changes = $this->jmapAs($username, [
            ['ContactCard/changes', ['accountId' => $username, 'sinceState' => $since], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([], $changes['created'], $username.': no card created');
        $this->assertSame([], $changes['updated'], $username.': no card updated');
        $this->assertSame([], $changes['destroyed'], $username.': no card destroyed');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->jmapContacts($methodCalls, $this->issueBearerTokenFor($username));
    }
}
