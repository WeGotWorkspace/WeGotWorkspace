<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\DAV\Exception\NotFound;

/**
 * Makes an address book node return {@see AppCard} children.
 */
trait AppAddressBookChildren
{
    public function getChild($name): AppCard
    {
        $obj = $this->carddavBackend->getCard($this->addressBookInfo['id'], $name);
        if (! $obj) {
            throw new NotFound('Card not found');
        }
        $obj['acl'] = $this->getChildACL();

        return new AppCard($this->carddavBackend, $this->addressBookInfo, $obj);
    }

    /**
     * @return list<AppCard>
     */
    public function getChildren(): array
    {
        $objs = $this->carddavBackend->getCards($this->addressBookInfo['id']);
        $children = [];
        foreach ($objs as $obj) {
            $obj['acl'] = $this->getChildACL();
            $children[] = new AppCard($this->carddavBackend, $this->addressBookInfo, $obj);
        }

        return $children;
    }

    /**
     * @param  array<int, string>  $paths
     * @return list<AppCard>
     */
    public function getMultipleChildren(array $paths): array
    {
        $objs = $this->carddavBackend->getMultipleCards($this->addressBookInfo['id'], $paths);
        $children = [];
        foreach ($objs as $obj) {
            $obj['acl'] = $this->getChildACL();
            $children[] = new AppCard($this->carddavBackend, $this->addressBookInfo, $obj);
        }

        return $children;
    }
}
