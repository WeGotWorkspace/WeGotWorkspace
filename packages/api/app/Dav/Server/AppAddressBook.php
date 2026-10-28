<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\AddressBook;

/**
 * {@see AddressBook} whose cards are {@see AppCard}, so a card can be renamed
 * inside its own book.
 */
final class AppAddressBook extends AddressBook
{
    use AppAddressBookChildren;
}
