<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CardDAV\AddressBookHome;
use Sabre\CardDAV\Backend\BackendInterface;
use Sabre\DAV;

/**
 * {@see AddressBookHome} whose address books are {@see AppAddressBook}.
 */
final class AppAddressBookHome extends AddressBookHome
{
    /**
     * Sabre types the inherited $principalUri as an array, but it holds the
     * principal URI, so keep a typed copy.
     */
    public function __construct(BackendInterface $carddavBackend, private readonly string $ownerUri)
    {
        parent::__construct($carddavBackend, $ownerUri);
    }

    /**
     * @return list<DAV\INode>
     */
    public function getChildren(): array
    {
        $children = [];
        foreach ($this->carddavBackend->getAddressBooksForUser($this->ownerUri) as $book) {
            $children[] = new AppAddressBook($this->carddavBackend, $book);
        }

        return $children;
    }

    public function getChild($name): DAV\INode
    {
        foreach ($this->carddavBackend->getAddressBooksForUser($this->ownerUri) as $book) {
            if ($book['uri'] === $name) {
                return new AppAddressBook($this->carddavBackend, $book);
            }
        }

        throw new DAV\Exception\NotFound('Addressbook with name \''.$name.'\' could not be found');
    }
}
