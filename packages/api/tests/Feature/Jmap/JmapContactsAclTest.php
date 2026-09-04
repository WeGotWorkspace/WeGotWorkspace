<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Cross-user ACL and feature-gate twins for contacts, lifted from
 * JmapRestCrossUserAclTest and ContactsAccessControlTest before the dual-protocol
 * /contacts/* routes were removed. Import stays on REST.
 */
final class JmapContactsAclTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_guest_cannot_access_contacts_jmap_or_import(): void
    {
        $this->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => [['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c0']],
        ])->assertUnauthorized();

        $this->getJson('/api/v1/jmap/session')->assertUnauthorized();
        $this->postJson('/api/v1/contacts/cards/import?addressBookId=default', [])->assertUnauthorized();
    }

    public function test_authenticated_user_can_access_contacts_when_enabled(): void
    {
        $this->jmapContacts([
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'AddressBook/get')
            ->assertJsonPath('methodResponses.1.0', 'ContactCard/get');
    }

    public function test_admin_can_access_contacts_as_user(): void
    {
        $this->seedDefaultAddressBookFor('alice');

        $this->jmapContacts([
            ['AddressBook/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ], $this->adminBearerToken())->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'AddressBook/get');
    }

    public function test_contacts_disabled_drops_the_domain_and_forbids_import(): void
    {
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, false);
        $token = $this->userBearerToken();

        $session = $this->withBearer($token)
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $this->assertArrayNotHasKey(JmapCapabilities::CONTACTS, $session['capabilities']);

        $this->withBearer($token)->postJson('/api/v1/contacts/cards/import?addressBookId=default', [])
            ->assertForbidden();
    }

    public function test_user_cannot_read_other_users_contact(): void
    {
        $cardId = $this->seedCardViaPdo('carol', 'carol-private.vcf', $this->sampleVcard('Carol Private'));

        $response = $this->jmapContacts([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => [$cardId]], 'c0'],
        ])->assertOk();

        $this->assertSame([], $response->json('methodResponses.0.1.list'));
        $this->assertSame([$cardId], $response->json('methodResponses.0.1.notFound'));
    }

    public function test_user_cannot_update_or_destroy_other_users_contact(): void
    {
        $cardId = $this->seedCardViaPdo('carol', 'carol-update.vcf', $this->sampleVcard('Carol Update'));

        $response = $this->jmapContacts([
            ['ContactCard/set', [
                'accountId' => 'bob',
                'update' => [$cardId => ['name' => ['full' => 'Hijacked']]],
                'destroy' => [$cardId],
            ], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.1.notUpdated.'.$cardId.'.type', 'notFound');
        $response->assertJsonPath('methodResponses.0.1.notDestroyed.'.$cardId.'.type', 'notFound');
        $this->assertSame([], $response->json('methodResponses.0.1.updated'));
        $this->assertSame([], $response->json('methodResponses.0.1.destroyed'));
    }

    public function test_user_cannot_list_other_users_address_book_cards(): void
    {
        $this->seedCardViaPdo('carol', 'carol-list.vcf', $this->sampleVcard('Carol List'));

        $response = $this->jmapContacts([
            ['ContactCard/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ['ContactCard/query', ['accountId' => 'bob'], 'c1'],
        ])->assertOk();

        $this->assertSame([], $response->json('methodResponses.0.1.list'));
        $this->assertSame([], $response->json('methodResponses.1.1.ids'));
    }

    public function test_users_only_see_own_address_books(): void
    {
        $bob = $this->jmapContacts([
            ['AddressBook/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk();
        $this->assertSame(['default'], array_column($bob->json('methodResponses.0.1.list'), 'id'));

        $carol = $this->jmapContacts([
            ['AddressBook/get', ['accountId' => 'carol', 'ids' => null], 'c0'],
        ], $this->carolBearerToken())->assertOk();
        $this->assertSame(['default'], array_column($carol->json('methodResponses.0.1.list'), 'id'));
    }
}
