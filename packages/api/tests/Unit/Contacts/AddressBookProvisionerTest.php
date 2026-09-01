<?php

declare(strict_types=1);

namespace Tests\Unit\Contacts;

use App\Models\Addressbook;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\AddressBookProvisioner;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class AddressBookProvisionerTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    public function test_ensure_for_principal_is_idempotent_and_uses_personal_name(): void
    {
        $this->seedWgwUser('provision-bob', displayName: 'Provision Bob');
        $provisioner = app(AddressBookProvisioner::class);

        $first = $provisioner->ensureForPrincipal('principals/provision-bob', 'Provision Bob');
        $second = $provisioner->ensureForPrincipal('principals/provision-bob', 'Provision Bob');

        $this->assertSame(1, $first['created']);
        $this->assertSame(0, $second['created']);
        $this->assertDatabaseHas('addressbooks', [
            'principaluri' => 'principals/provision-bob',
            'uri' => AddressBookCollectionUris::CALDAV_URI,
            'displayname' => AddressBookCollectionUris::PERSONAL_DISPLAY_NAME,
        ], 'wgw');
    }

    public function test_ensure_rewrites_existing_user_book_displayname_to_personal(): void
    {
        $this->seedWgwUser('provision-bob', displayName: 'Provision Bob');
        $provisioner = app(AddressBookProvisioner::class);
        $provisioner->ensureForPrincipal('principals/provision-bob', 'Provision Bob');

        Addressbook::query()
            ->where('principaluri', 'principals/provision-bob')
            ->update(['displayname' => 'Provision Bob']);

        $this->assertSame(0, $provisioner->ensureForPrincipal('principals/provision-bob', 'Provision Bob')['created']);
        $this->assertDatabaseHas('addressbooks', [
            'principaluri' => 'principals/provision-bob',
            'uri' => AddressBookCollectionUris::CALDAV_URI,
            'displayname' => AddressBookCollectionUris::PERSONAL_DISPLAY_NAME,
        ], 'wgw');
    }

    public function test_ensure_for_group_principal_creates_one_book(): void
    {
        $this->seedWgwGroup('principals/groups/design', 'Design');
        $provisioner = app(AddressBookProvisioner::class);

        $this->assertTrue($provisioner->ensureForGroupPrincipal('principals/groups/design', 'Design'));
        $this->assertFalse($provisioner->ensureForGroupPrincipal('principals/groups/design', 'Design'));
        $this->assertDatabaseHas('addressbooks', [
            'principaluri' => 'principals/groups/design',
            'uri' => AddressBookCollectionUris::CALDAV_URI,
            'displayname' => 'Design',
        ], 'wgw');
    }
}
