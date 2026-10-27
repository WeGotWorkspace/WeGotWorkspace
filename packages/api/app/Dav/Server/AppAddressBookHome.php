<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\AddressBookHome;
use Sabre\DAV;

/**
 * {@see AddressBookHome} whose address books are {@see AppAddressBook}.
 */
final class AppAddressBookHome extends AddressBookHome
{
    /**
     * @return list<DAV\INode>
     */
    public function getChildren(): array
    {
        $children = [];
        foreach ($this->carddavBackend->getAddressBooksForUser($this->principalUri) as $book) {
            $children[] = new AppAddressBook($this->carddavBackend, $book);
        }

        return $children;
    }

    public function getChild($name): DAV\INode
    {
        foreach ($this->carddavBackend->getAddressBooksForUser($this->principalUri) as $book) {
            if ($book['uri'] === $name) {
                return new AppAddressBook($this->carddavBackend, $book);
            }
        }

        throw new DAV\Exception\NotFound('Addressbook with name \''.$name.'\' could not be found');
    }
}
