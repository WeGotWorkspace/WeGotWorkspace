<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\SharedAddressBook;

/**
 * {@see SharedAddressBook} (exposes the CardDAV sharing properties) whose cards
 * are {@see AppCard}.
 */
final class AppSharedAddressBook extends SharedAddressBook
{
    use AppAddressBookChildren;
}
