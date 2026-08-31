<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Contacts envelope lifecycle contract (#437), modeled on
 * JmapClientContractTest: the exact call sequence a spec-faithful JMAP
 * contacts client performs — connect, initial sync, batched query+get via a
 * ResultReference, write, incremental sync — plus the mixed-domain batch
 * case from the multidomain spec (per-domain states never bleed).
 */
final class JmapContactsClientContractTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setUpContactsFixtures();
        // The calendars fixture seeds the users first, which makes the
        // contacts role-matrix seeding return early — seed bob's default
        // address book explicitly.
        $this->seedDefaultAddressBookFor('bob');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     * @param  list<string>|null  $using
     */
    private function jmap(array $methodCalls, ?array $using = null): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => $using ?? [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_full_contacts_client_lifecycle_stays_on_the_incremental_path(): void
    {
        // connect(): the session advertises the contacts capability.
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $accountId = $session['primaryAccounts'][JmapCapabilities::CONTACTS];
        $this->assertSame('bob', $accountId);

        // Initial sync: books + cards, capturing the account-wide state.
        $initial = $this->jmap([
            ['AddressBook/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
            ['ContactCard/get', ['accountId' => $accountId, 'ids' => null], 'c1'],
        ])->assertOk();
        $cardStateS0 = $initial->json('methodResponses.1.1.state');
        $this->assertSame([], $initial->json('methodResponses.1.1.list'));

        // Write: create a card.
        $create = $this->jmap([
            ['ContactCard/set', ['accountId' => $accountId, 'create' => ['k0' => $this->sampleContactCardPayload()]], 'c2'],
        ])->assertOk();
        $cardId = $create->json('methodResponses.0.1.created.k0.id');
        $this->assertIsString($cardId);

        // Incremental sync after the write: /changes accepts the state a get
        // returned earlier — never cannotCalculateChanges (mismatch-13 replay).
        $changes = $this->jmap([
            ['ContactCard/changes', ['accountId' => $accountId, 'sinceState' => $cardStateS0], 'c3'],
        ])->assertOk();
        $changes->assertJsonPath('methodResponses.0.0', 'ContactCard/changes');
        $this->assertContains($cardId, $changes->json('methodResponses.0.1.created'));
        $cardStateS1 = $changes->json('methodResponses.0.1.newState');

        // Batched query → get wired with the "#ids" ResultReference — the
        // exact pattern the shipped calendars client uses for range loads.
        $batch = $this->jmap([
            ['ContactCard/query', ['accountId' => $accountId], 'c4'],
            ['ContactCard/get', [
                'accountId' => $accountId,
                '#ids' => ['resultOf' => 'c4', 'name' => 'ContactCard/query', 'path' => '/ids'],
            ], 'c5'],
        ])->assertOk();
        $this->assertSame([$cardId], $batch->json('methodResponses.0.1.ids'));
        $this->assertSame($cardId, $batch->json('methodResponses.1.1.list.0.id'));

        // Update, then sync incrementally from S1.
        $this->jmap([
            ['ContactCard/set', ['accountId' => $accountId, 'update' => [$cardId => ['name' => ['full' => 'Renamed']]]], 'c6'],
        ])->assertOk();
        $afterUpdate = $this->jmap([
            ['ContactCard/changes', ['accountId' => $accountId, 'sinceState' => $cardStateS1], 'c7'],
        ])->assertOk();
        $this->assertContains($cardId, $afterUpdate->json('methodResponses.0.1.updated'));
        $cardStateS2 = $afterUpdate->json('methodResponses.0.1.newState');

        // Destroy, then sync incrementally from S2.
        $this->jmap([
            ['ContactCard/set', ['accountId' => $accountId, 'destroy' => [$cardId]], 'c8'],
        ])->assertOk();
        $afterDestroy = $this->jmap([
            ['ContactCard/changes', ['accountId' => $accountId, 'sinceState' => $cardStateS2], 'c9'],
        ])->assertOk();
        $this->assertContains($cardId, $afterDestroy->json('methodResponses.0.1.destroyed'));
    }

    public function test_mixed_domain_batch_shares_one_dispatcher_pass_without_state_bleed(): void
    {
        $response = $this->jmap([
            ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
        ], [JmapCapabilities::CORE, JmapCapabilities::CALENDARS, JmapCapabilities::CONTACTS])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'Calendar/get');
        $response->assertJsonPath('methodResponses.1.0', 'AddressBook/get');

        // Per-domain states are composed over different collections (VEVENT
        // calendars vs address books) and must not bleed into each other.
        $calendarUris = array_keys((array) JmapAccountStateCodec::decompose($response->json('methodResponses.0.1.state')));
        $contactsUris = array_keys((array) JmapAccountStateCodec::decompose($response->json('methodResponses.1.1.state')));

        $this->assertContains('default', $contactsUris);
        $this->assertContains('default', $calendarUris);
        $this->assertEqualsCanonicalizing(
            array_column($response->json('methodResponses.1.1.list'), 'id'),
            $contactsUris,
        );
        $this->assertSame(['default'], $contactsUris);
    }

    public function test_a_domain_method_without_its_capability_in_using_is_unknown(): void
    {
        $response = $this->jmap([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ], [JmapCapabilities::CORE, JmapCapabilities::CALENDARS])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'error');
        $response->assertJsonPath('methodResponses.0.1.type', 'unknownMethod');
    }
}
