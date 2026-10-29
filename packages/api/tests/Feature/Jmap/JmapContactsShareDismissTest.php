<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\Addressbook;
use App\Services\Jmap\JmapCapabilities;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Dismissing an inbound address-book share ends access by every id until the
 * sharee restores it with `isSubscribed: true`. The owner's grant stays.
 */
final class JmapContactsShareDismissTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $this->seedDefaultAddressBookFor('alice');
        Addressbook::query()->where('principaluri', 'principals/bob')->update(['displayname' => 'Bob']);
    }

    public function test_dismissed_book_no_longer_resolves_by_id(): void
    {
        [$sharedId, $cardId] = $this->sharedBookWithCard();

        $this->assertSame([$sharedId], $this->jmap('alice', 'AddressBook/set', ['destroy' => [$sharedId]])['destroyed']);

        $this->assertSame([$sharedId], $this->jmap('alice', 'AddressBook/get', ['ids' => [$sharedId]])['notFound']);
        $this->assertSame([$cardId], $this->jmap('alice', 'ContactCard/get', ['ids' => [$cardId]])['notFound']);
        $this->assertSame('notFound', $this->jmap('alice', 'AddressBook/set', ['destroy' => [$sharedId]])['notDestroyed'][$sharedId]['type']);
        $this->assertSame('notFound', $this->jmap('alice', 'AddressBook/set', ['update' => [$sharedId => ['isSubscribed' => false]]])['notUpdated'][$sharedId]['type']);
        $this->assertIsArray($this->jmap('bob', 'AddressBook/get', ['ids' => ['default']])['list'][0]['shareWith']['alice']);
    }

    public function test_restoring_a_dismissed_book_brings_access_back(): void
    {
        [$sharedId, $cardId] = $this->sharedBookWithCard();
        $this->jmap('alice', 'AddressBook/set', ['destroy' => [$sharedId]]);

        $restored = $this->jmap('alice', 'AddressBook/set', ['update' => [$sharedId => ['isSubscribed' => true]]]);

        $this->assertArrayHasKey($sharedId, $restored['updated']);
        $this->assertSame($sharedId, $this->jmap('alice', 'AddressBook/get', ['ids' => [$sharedId]])['list'][0]['id']);
        $this->assertSame([$sharedId => true], $this->jmap('alice', 'ContactCard/get', ['ids' => [$cardId]])['list'][0]['addressBookIds']);
        $created = $this->jmap('alice', 'ContactCard/set', ['create' => ['n' => $this->sampleContactCardPayload($sharedId)]]);
        $this->assertArrayHasKey('n', $created['created']);
    }

    public function test_a_revoked_share_cannot_be_restored(): void
    {
        [$sharedId] = $this->sharedBookWithCard();
        $this->jmap('alice', 'AddressBook/set', ['destroy' => [$sharedId]]);
        $this->jmap('bob', 'AddressBook/set', ['update' => ['default' => ['shareWith' => ['alice' => null]]]]);

        $updated = $this->jmap('alice', 'AddressBook/set', ['update' => [$sharedId => ['isSubscribed' => true]]]);

        $this->assertSame('notFound', $updated['notUpdated'][$sharedId]['type']);
        $this->assertSame([$sharedId], $this->jmap('alice', 'AddressBook/get', ['ids' => [$sharedId]])['notFound']);
    }

    /**
     * @return array{0: string, 1: string} sharee book id, owner card id
     */
    private function sharedBookWithCard(): array
    {
        $shared = $this->jmap('bob', 'AddressBook/set', ['update' => ['default' => ['shareWith' => ['alice' => ['mayWrite' => true]]]]]);
        $this->assertArrayHasKey('default', $shared['updated']);
        $cardId = (string) $this->jmap('bob', 'ContactCard/set', ['create' => ['c' => $this->sampleContactCardPayload('default')]])['created']['c']['id'];

        $book = collect($this->jmap('alice', 'AddressBook/get', ['ids' => null])['list'])
            ->first(static fn (array $row): bool => ($row['isSharee'] ?? false) === true);
        $this->assertIsArray($book);

        return [(string) $book['id'], $cardId];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    private function jmap(string $username, string $method, array $args): array
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);
        $response = $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => [[$method, ['accountId' => $username, ...$args], 'c0']],
        ])->assertOk()->json('methodResponses.0');
        $this->assertSame($method, $response[0], json_encode($response) ?: '');

        return $response[1];
    }
}
