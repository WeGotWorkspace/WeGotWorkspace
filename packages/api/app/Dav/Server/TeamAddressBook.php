<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\AddressBook;
use Sabre\CardDAV\Backend\BackendInterface;
use Sabre\DAV\Exception\Forbidden;

/**
 * A Team address book as it appears in a member's own address book home (#2158),
 * under the name {@see TeamCollectionName::make()}. The ACL stays on the Team
 * principal, so members read and write it through their Team membership.
 * Deleting it from a native app is refused, as for {@see TeamCalendar}.
 */
final class TeamAddressBook extends AddressBook
{
    use AppAddressBookChildren;

    /**
     * @param  array<string, mixed>  $addressBookInfo  the Team's own address book row
     */
    public static function forMember(BackendInterface $backend, string $slug, array $addressBookInfo): self
    {
        $addressBookInfo['uri'] = TeamCollectionName::make($slug, (string) $addressBookInfo['uri']);

        return new self($backend, $addressBookInfo);
    }

    public function delete(): void
    {
        throw new Forbidden('A Team address book cannot be removed from a contacts app.');
    }
}
