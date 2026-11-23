<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Admin\AdminConstants;
use App\Services\Teams\TeamColleagues;
use Sabre\CardDAV\AddressBookHome;
use Sabre\CardDAV\Backend\BackendInterface;
use Sabre\DAV;
use Sabre\DAV\MkCol;

/**
 * {@see AddressBookHome} whose address books are {@see AppAddressBook}, plus the
 * address books of the owner's Teams as {@see TeamAddressBook} (#2158).
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
        $ids = [];
        foreach ($this->carddavBackend->getAddressBooksForUser($this->ownerUri) as $book) {
            $ids[(string) $book['id']] = true;
            $children[] = new AppAddressBook($this->carddavBackend, $book);
        }
        foreach ($this->teamSlugs() as $slug) {
            foreach ($this->teamBooks($slug) as $book) {
                if (! isset($ids[(string) $book['id']])) {
                    $ids[(string) $book['id']] = true;
                    $children[] = TeamAddressBook::forMember($this->carddavBackend, $slug, $book);
                }
            }
        }

        return $children;
    }

    public function getChild($name): DAV\INode
    {
        $parsed = TeamCollectionName::parse((string) $name);
        if ($parsed !== null) {
            foreach ($this->teamBooks($parsed['slug']) as $book) {
                if ($book['uri'] === $parsed['uri']) {
                    return TeamAddressBook::forMember($this->carddavBackend, $parsed['slug'], $book);
                }
            }
        } else {
            foreach ($this->carddavBackend->getAddressBooksForUser($this->ownerUri) as $book) {
                if ($book['uri'] === $name) {
                    return new AppAddressBook($this->carddavBackend, $book);
                }
            }
        }

        throw new DAV\Exception\NotFound('Addressbook with name \''.$name.'\' could not be found');
    }

    /**
     * The `team~` names belong to Team address books, so a member's own book may not take one.
     *
     * @param  string  $name
     */
    public function createExtendedCollection($name, MkCol $mkCol): void
    {
        if (TeamCollectionName::isReserved((string) $name)) {
            throw new DAV\Exception\Forbidden('Address book names starting with "'.TeamCollectionName::PREFIX.'" are reserved for Team address books.');
        }
        parent::createExtendedCollection($name, $mkCol);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function teamBooks(string $slug): array
    {
        if (! in_array($slug, $this->teamSlugs(), true)) {
            return [];
        }

        return array_values($this->carddavBackend->getAddressBooksForUser(AdminConstants::GROUP_PREFIX.$slug));
    }

    /**
     * @return list<string>
     */
    private function teamSlugs(): array
    {
        if (! str_starts_with($this->ownerUri, 'principals/') || str_starts_with($this->ownerUri, AdminConstants::GROUP_PREFIX)) {
            return [];
        }

        return app(TeamColleagues::class)->teamSlugsOf(substr($this->ownerUri, strlen('principals/')));
    }
}
