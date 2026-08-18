<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use App\Support\WgwSettings;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Access control for the remaining contacts REST island: POST /contacts/cards/import.
 * Envelope gating lives in JmapContactsAclTest / JmapContactsMethodsTest.
 */
final class ContactsAccessControlTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_guest_cannot_import_contacts(): void
    {
        $this->postJson('/api/v1/contacts/cards/import?addressBookId=default', [])
            ->assertUnauthorized();
    }

    public function test_authenticated_user_can_reach_import_when_enabled(): void
    {
        $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
                'CONTENT_TYPE' => 'text/vcard',
                'HTTP_ACCEPT' => 'application/json',
            ],
            '',
        )->assertStatus(400);
    }

    public function test_admin_can_reach_import_as_user(): void
    {
        $this->seedDefaultAddressBookFor('alice');

        $this->call(
            'POST',
            '/api/v1/contacts/cards/import?addressBookId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->adminBearerToken(),
                'CONTENT_TYPE' => 'text/vcard',
                'HTTP_ACCEPT' => 'application/json',
            ],
            '',
        )->assertStatus(400);
    }

    public function test_contacts_disabled_forbids_import(): void
    {
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, false);

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards/import?addressBookId=default', [])
            ->assertForbidden();
    }
}
