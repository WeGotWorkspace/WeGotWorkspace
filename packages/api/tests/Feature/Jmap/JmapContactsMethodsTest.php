<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Contacts envelope methods (#437, RFC 9610): AddressBook/get|changes|set and
 * ContactCard/get|changes|set|query|queryChanges over the existing contacts
 * services, with legacy REST shapes normalized at the adapter layer.
 */
final class JmapContactsMethodsTest extends WgwDatabaseTestCase
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
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_session_advertises_contacts_with_rfc9610_capability_placement(): void
    {
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();

        // Session-level contacts capability is the EMPTY object; the
        // two-property object lives at the account level (RFC 9610 §1.3).
        $this->assertSame([], $session['capabilities'][JmapCapabilities::CONTACTS]);
        $contacts = $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::CONTACTS];
        $this->assertSame(1, $contacts['maxAddressBooksPerCard']);
        $this->assertTrue($contacts['mayCreateAddressBook']);
        $this->assertSame('bob', $session['primaryAccounts'][JmapCapabilities::CONTACTS]);
    }

    public function test_contacts_feature_gate_drops_the_domain_without_taking_the_envelope_down(): void
    {
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, false);

        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $this->assertArrayNotHasKey(JmapCapabilities::CONTACTS, $session['capabilities']);
        $this->assertArrayNotHasKey(JmapCapabilities::CONTACTS, $session['primaryAccounts']);

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => [['Core/echo', ['a' => 1], 'c0']],
        ])->assertStatus(400)->assertJsonPath('type', 'urn:ietf:params:jmap:error:unknownCapability');
    }

    public function test_address_book_get_returns_the_rfc9610_shape_with_decomposable_state(): void
    {
        $response = $this->jmap([
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'AddressBook/get');
        $args = $response->json('methodResponses.0.1');
        $this->assertSame('bob', $args['accountId']);
        $this->assertNotNull(JmapAccountStateCodec::decompose($args['state']));

        $default = collect($args['list'])->firstWhere('id', 'default');
        $this->assertNotNull($default);
        $this->assertTrue($default['isDefault']);
        // AddressBookRights per RFC 9610 §2 — the four-property object.
        $this->assertSame(
            ['mayRead' => true, 'mayWrite' => true, 'mayShare' => false, 'mayDelete' => false],
            $default['myRights'],
        );
        $this->assertSame([], $response->json('methodResponses.0.1.notFound'));
    }

    public function test_address_book_get_reports_unknown_ids_as_not_found(): void
    {
        $response = $this->jmap([
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => ['default', 'missing-book']], 'c0'],
        ])->assertOk();

        $this->assertCount(1, $response->json('methodResponses.0.1.list'));
        $this->assertSame(['missing-book'], $response->json('methodResponses.0.1.notFound'));
    }

    public function test_address_book_set_lifecycle_create_update_destroy(): void
    {
        $create = $this->jmap([
            ['AddressBook/set', ['accountId' => 'bob', 'create' => ['b0' => ['name' => 'Team']]], 'c0'],
        ])->assertOk();

        $created = $create->json('methodResponses.0.1.created.b0');
        $this->assertIsArray($created);
        $bookId = $created['id'];
        $this->assertSame('Team', $created['name']);
        $oldState = $create->json('methodResponses.0.1.oldState');
        $newState = $create->json('methodResponses.0.1.newState');
        $this->assertNotSame($oldState, $newState);
        $this->assertNotNull(JmapAccountStateCodec::decompose($newState));

        $update = $this->jmap([
            ['AddressBook/set', ['accountId' => 'bob', 'update' => [$bookId => ['name' => 'Team 2']]], 'c1'],
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => [$bookId]], 'c2'],
        ])->assertOk();
        $this->assertNull($update->json('methodResponses.0.1.updated.'.$bookId));
        $this->assertSame('Team 2', $update->json('methodResponses.1.1.list.0.name'));

        $destroy = $this->jmap([
            ['AddressBook/set', ['accountId' => 'bob', 'destroy' => [$bookId]], 'c3'],
        ])->assertOk();
        $this->assertSame([$bookId], $destroy->json('methodResponses.0.1.destroyed'));
    }

    public function test_address_book_destroy_with_cards_requires_on_destroy_remove_contents(): void
    {
        $this->jmap([
            ['AddressBook/set', ['accountId' => 'bob', 'create' => ['b0' => ['name' => 'Filled', 'id' => 'filled']]], 'c0'],
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => $this->sampleContactCardPayload('filled')]], 'c1'],
        ])->assertOk();

        $rejected = $this->jmap([
            ['AddressBook/set', ['accountId' => 'bob', 'destroy' => ['filled']], 'c2'],
        ])->assertOk();
        // RFC 9610 §2.2 SetError for a non-empty book without the flag.
        $rejected->assertJsonPath('methodResponses.0.1.notDestroyed.filled.type', 'addressBookHasContents');

        $removed = $this->jmap([
            ['AddressBook/set', ['accountId' => 'bob', 'destroy' => ['filled'], 'onDestroyRemoveContents' => true], 'c3'],
        ])->assertOk();
        $this->assertSame(['filled'], $removed->json('methodResponses.0.1.destroyed'));
    }

    public function test_address_book_set_rejects_on_success_set_is_default(): void
    {
        $response = $this->jmap([
            ['AddressBook/set', ['accountId' => 'bob', 'onSuccessSetIsDefault' => '#b0', 'create' => ['b0' => ['name' => 'X']]], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'error');
        $response->assertJsonPath('methodResponses.0.1.type', 'invalidArguments');
    }

    public function test_address_book_changes_covers_initial_updated_and_malformed_branches(): void
    {
        $initial = $this->jmap([
            ['AddressBook/changes', ['accountId' => 'bob', 'sinceState' => '0:'], 'c0'],
        ])->assertOk();
        $this->assertContains('default', $initial->json('methodResponses.0.1.created'));
        $state = $initial->json('methodResponses.0.1.newState');

        // Card activity bumps the book's synctoken → book over-reports as updated.
        $this->jmap([
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => $this->sampleContactCardPayload()]], 'c1'],
        ])->assertOk();
        $afterCard = $this->jmap([
            ['AddressBook/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c2'],
        ])->assertOk();
        $this->assertContains('default', $afterCard->json('methodResponses.0.1.updated'));
        $this->assertFalse($afterCard->json('methodResponses.0.1.hasMoreChanges'));

        $malformed = $this->jmap([
            ['AddressBook/changes', ['accountId' => 'bob', 'sinceState' => 'garbage'], 'c3'],
        ])->assertOk();
        $malformed->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }

    public function test_contact_card_get_by_ids_and_get_all(): void
    {
        $cardId = $this->seedCardViaPdo('bob', 'jane.vcf', $this->sampleVcard('Jane Doe'));

        $byId = $this->jmap([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => [$cardId, 'missing-card']], 'c0'],
        ])->assertOk();
        $card = $byId->json('methodResponses.0.1.list.0');
        $this->assertSame($cardId, $card['id']);
        $this->assertSame(['default' => true], $card['addressBookIds']);
        $this->assertIsString($card['state']);
        $this->assertSame(['missing-card'], $byId->json('methodResponses.0.1.notFound'));
        $this->assertNotNull(JmapAccountStateCodec::decompose($byId->json('methodResponses.0.1.state')));

        $all = $this->jmap([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
        ])->assertOk();
        $this->assertSame([$cardId], array_column($all->json('methodResponses.0.1.list'), 'id'));
    }

    public function test_contact_card_set_normalizes_the_legacy_shapes_to_rfc8620(): void
    {
        $create = $this->jmap([
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => $this->sampleContactCardPayload()]], 'c0'],
        ])->assertOk();

        // Legacy REST: created maps creationId → bare id string. Envelope:
        // creationId → {id, state} object (RFC 8620 §5.3 server-set props).
        $created = $create->json('methodResponses.0.1.created.k0');
        $this->assertIsArray($created);
        $this->assertIsString($created['id']);
        $this->assertIsString($created['state']);
        $cardId = $created['id'];

        $update = $this->jmap([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$cardId => ['name' => ['full' => 'Renamed Contact']]]], 'c1'],
        ])->assertOk();
        // Legacy REST: updated maps id → bare state string. Envelope: id → {state}.
        $this->assertIsString($update->json('methodResponses.0.1.updated.'.$cardId.'.state'));

        // Legacy REST error types are snake_case ('not_found'); the envelope
        // normalizes to the RFC vocabulary.
        $errors = $this->jmap([
            ['ContactCard/set', [
                'accountId' => 'bob',
                'create' => ['bad' => ['name' => ['full' => 'No book']]],
                'update' => ['missing-card' => ['name' => ['full' => 'X']]],
                'destroy' => ['also-missing'],
            ], 'c2'],
        ])->assertOk();
        $errors->assertJsonPath('methodResponses.0.1.notCreated.bad.type', 'invalidProperties');
        $errors->assertJsonPath('methodResponses.0.1.notUpdated.missing-card.type', 'notFound');
        $errors->assertJsonPath('methodResponses.0.1.notDestroyed.also-missing.type', 'notFound');

        $destroy = $this->jmap([
            ['ContactCard/set', ['accountId' => 'bob', 'destroy' => [$cardId]], 'c3'],
        ])->assertOk();
        $this->assertSame([$cardId], $destroy->json('methodResponses.0.1.destroyed'));
    }

    public function test_contact_card_set_with_unknown_media_blob_id_is_invalid_properties(): void
    {
        $payload = $this->sampleContactCardPayload();
        $payload['media'] = [
            'm1' => ['kind' => 'photo', 'blobId' => 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
        ];

        $create = $this->jmap([
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => $payload]], 'c0'],
        ])->assertOk();
        // spec.md edge case: unknown/foreign blobId → invalidProperties,
        // never serverFail (a client-input problem, not a server bug).
        $create->assertJsonPath('methodResponses.0.1.notCreated.k0.type', 'invalidProperties');

        $cardId = $this->jmap([
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k1' => $this->sampleContactCardPayload()]], 'c1'],
        ])->assertOk()->json('methodResponses.0.1.created.k1.id');
        $update = $this->jmap([
            ['ContactCard/set', ['accountId' => 'bob', 'update' => [$cardId => ['media' => $payload['media']]]], 'c2'],
        ])->assertOk();
        $update->assertJsonPath('methodResponses.0.1.notUpdated.'.$cardId.'.type', 'invalidProperties');
    }

    public function test_contact_card_set_top_level_if_in_state_rejects_stale_state_without_mutating(): void
    {
        $response = $this->jmap([
            ['ContactCard/set', [
                'accountId' => 'bob',
                'ifInState' => '1:default:999999',
                'create' => ['k0' => $this->sampleContactCardPayload()],
            ], 'c0'],
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'error');
        $response->assertJsonPath('methodResponses.0.1.type', 'stateMismatch');
        // Nothing was mutated: the account still has zero cards.
        $this->assertSame([], $response->json('methodResponses.1.1.list'));
    }

    public function test_contact_card_set_with_matching_if_in_state_proceeds(): void
    {
        $current = $this->jmap([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $response = $this->jmap([
            ['ContactCard/set', [
                'accountId' => 'bob',
                'ifInState' => $current,
                'create' => ['k0' => $this->sampleContactCardPayload()],
            ], 'c1'],
        ])->assertOk();

        $this->assertSame($current, $response->json('methodResponses.0.1.oldState'));
        $this->assertIsString($response->json('methodResponses.0.1.created.k0.id'));
    }

    public function test_contact_card_query_filters_and_windowing(): void
    {
        $uid = 'urn:uuid:11111111-2222-3333-4444-555555555555';
        $janeId = $this->seedCardViaPdo('bob', 'jane.vcf', $this->sampleVcard('Jane Doe', $uid));
        $johnId = $this->seedCardViaPdo('bob', 'john.vcf', $this->sampleVcard('John Doe'));

        // No filter: fan out over every owned book.
        $all = $this->jmap([
            ['ContactCard/query', ['accountId' => 'bob'], 'c0'],
        ])->assertOk();
        $this->assertEqualsCanonicalizing([$janeId, $johnId], $all->json('methodResponses.0.1.ids'));
        $this->assertSame(2, $all->json('methodResponses.0.1.total'));
        $this->assertFalse($all->json('methodResponses.0.1.canCalculateChanges'));

        $byUid = $this->jmap([
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['uid' => $uid]], 'c1'],
        ])->assertOk();
        $this->assertSame([$janeId], $byUid->json('methodResponses.0.1.ids'));

        $windowed = $this->jmap([
            ['ContactCard/query', ['accountId' => 'bob', 'position' => 1, 'limit' => 5], 'c2'],
        ])->assertOk();
        $this->assertCount(1, $windowed->json('methodResponses.0.1.ids'));
        $this->assertSame(2, $windowed->json('methodResponses.0.1.total'));
        $this->assertSame(1, $windowed->json('methodResponses.0.1.position'));
    }

    public function test_contact_card_query_rejects_unsupported_filters_and_sorts(): void
    {
        $unsupportedFilter = $this->jmap([
            ['ContactCard/query', ['accountId' => 'bob', 'filter' => ['kind' => 'group']], 'c0'],
        ])->assertOk();
        $unsupportedFilter->assertJsonPath('methodResponses.0.1.type', 'unsupportedFilter');

        $unsupportedSort = $this->jmap([
            ['ContactCard/query', ['accountId' => 'bob', 'sort' => [['property' => 'created']]], 'c1'],
        ])->assertOk();
        $unsupportedSort->assertJsonPath('methodResponses.0.1.type', 'unsupportedSort');
    }

    public function test_contact_card_query_changes_is_cannot_calculate_changes(): void
    {
        $response = $this->jmap([
            ['ContactCard/queryChanges', ['accountId' => 'bob', 'sinceQueryState' => '0:'], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'error');
        $response->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }

    public function test_contact_card_changes_fan_out_branches(): void
    {
        // Branch: initial sync — everything is created.
        $seedId = $this->seedCardViaPdo('bob', 'jane.vcf', $this->sampleVcard('Jane Doe'));
        $initial = $this->jmap([
            ['ContactCard/changes', ['accountId' => 'bob', 'sinceState' => '0:'], 'c0'],
        ])->assertOk();
        $this->assertContains($seedId, $initial->json('methodResponses.0.1.created'));
        $state = $initial->json('methodResponses.0.1.newState');

        // Branch: token changed — post-write incremental path (mismatch-13 replay).
        $create = $this->jmap([
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => $this->sampleContactCardPayload()]], 'c1'],
        ])->assertOk();
        $newId = $create->json('methodResponses.0.1.created.k0.id');
        $incremental = $this->jmap([
            ['ContactCard/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c2'],
        ])->assertOk();
        $incremental->assertJsonPath('methodResponses.0.1.oldState', $state);
        $this->assertContains($newId, $incremental->json('methodResponses.0.1.created'));
        $this->assertNotContains($seedId, $incremental->json('methodResponses.0.1.created'));

        // Branch: malformed sinceState.
        $this->jmap([
            ['ContactCard/changes', ['accountId' => 'bob', 'sinceState' => 'garbage'], 'c3'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }

    public function test_contact_card_changes_expands_a_destroyed_book_into_destroyed_card_ids(): void
    {
        // Create a second book with one card, read it (records the state row),
        // and capture the account state.
        $setup = $this->jmap([
            ['AddressBook/set', ['accountId' => 'bob', 'create' => ['b0' => ['name' => 'Doomed', 'id' => 'doomed']]], 'c0'],
            ['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => $this->sampleContactCardPayload('doomed')]], 'c1'],
        ])->assertOk();
        $cardId = $setup->json('methodResponses.1.1.created.k0.id');

        $state = $this->jmap([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => null], 'c2'],
        ])->assertOk()->json('methodResponses.0.1.state');

        // Destroy the whole book: Sabre removes the cards directly, so only
        // the recorded state rows can expand the deletion into card ids.
        $this->jmap([
            ['AddressBook/set', ['accountId' => 'bob', 'destroy' => ['doomed'], 'onDestroyRemoveContents' => true], 'c3'],
        ])->assertOk();

        $changes = $this->jmap([
            ['ContactCard/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c4'],
        ])->assertOk();
        $this->assertContains($cardId, $changes->json('methodResponses.0.1.destroyed'));
    }
}
