<?php

declare(strict_types=1);

namespace Tests\Feature\Projects\Cycle;

use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Jmap\JmapCapabilities;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #819: the membership cycle of one Team and one Project, seen through Contacts.
 */
final class ContactsCycleTest extends WgwDatabaseTestCase
{
    use WalksTheMembershipCycle;

    public function test_the_membership_cycle_in_contacts(): void
    {
        $this->walkTheCycle();
    }

    /** A Project has no address book of its own: the Team's is the Contacts side of the Team. */
    protected function seesProjectContent(string $user): ?bool
    {
        return null;
    }

    protected function seesTeamAsset(string $user): ?bool
    {
        $got = $this->jmapCall($user, JmapCapabilities::CONTACTS, [['AddressBook/get', ['accountId' => $user, 'ids' => null], 'g']]);

        return in_array(AddressBookCollectionUris::groupApiId('t1'), array_map('strval', array_column((array) ($got['list'] ?? []), 'id')), true);
    }
}
