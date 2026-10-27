<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\AddressBookHome;
use Sabre\CardDAV\Backend\SharingSupport;
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
            $children[] = $this->nodeFor($book);
        }

        return $children;
    }

    public function getChild($name): DAV\INode
    {
        foreach ($this->carddavBackend->getAddressBooksForUser($this->principalUri) as $book) {
            if ($book['uri'] === $name) {
                return $this->nodeFor($book);
            }
        }

        throw new DAV\Exception\NotFound('Addressbook with name \''.$name.'\' could not be found');
    }

    /**
     * @param  array<string, mixed>  $book
     */
    private function nodeFor(array $book): DAV\INode
    {
        if ($this->carddavBackend instanceof SharingSupport) {
            return new \Sabre\CardDAV\SharedAddressBook($this->carddavBackend, $book);
        }

        return new AppAddressBook($this->carddavBackend, $book);
    }
}
