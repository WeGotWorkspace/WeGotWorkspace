<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Exceptions\ApiHttpException;
use App\Models\Addressbook;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Drive\DriveGroupResolver;
use Illuminate\Database\Eloquent\Collection;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Owned + group-membership + inbound share listings, with personal-book
 * owner-over-sharee dedup and per-user dismissals.
 */
final class AddressBookCollectionAccess
{
    public function __construct(
        private readonly AddressBookProvisioner $provisioner,
        private readonly DriveGroupResolver $groups,
        private readonly AddressBookShareInvites $shareInvites,
        private readonly AddressBookShareVisibility $shareVisibility,
    ) {}

    /**
     * @return list<AddressBookListing>
     */
    public function accessibleListings(string $username): array
    {
        $this->ensureVisible($username);

        $owned = $this->ownedBooks($username);
        $ownedIds = [];
        $listings = [];
        foreach ($owned as $book) {
            $ownedIds[(int) $book->id] = true;
            $listings[] = new AddressBookListing(
                $book,
                isSharee: false,
                access: SharingPlugin::ACCESS_SHAREDOWNER,
            );
        }

        $inboundAccess = $this->shareInvites->highestAccessByBook($this->shareePrincipalUris($username));
        if ($inboundAccess === []) {
            return $listings;
        }

        $inboundBooks = Addressbook::query()
            ->whereIn('id', array_keys($inboundAccess))
            ->get()
            ->keyBy(static fn (Addressbook $book): int => (int) $book->id);

        foreach ($inboundAccess as $bookId => $access) {
            if (isset($ownedIds[$bookId])) {
                continue;
            }
            if ($this->shareVisibility->isDismissed($username, $bookId)) {
                continue;
            }
            $book = $inboundBooks->get($bookId);
            if ($book === null) {
                continue;
            }
            $listings[] = new AddressBookListing($book, isSharee: true, access: $access);
        }

        return $listings;
    }

    public function listingFor(string $username, string $addressBookId): ?AddressBookListing
    {
        foreach ($this->accessibleListings($username) as $listing) {
            if ($this->apiIdForListing($listing) === $addressBookId) {
                return $listing;
            }
        }

        return null;
    }

    public function listingForBook(string $username, Addressbook $book): ?AddressBookListing
    {
        foreach ($this->accessibleListings($username) as $listing) {
            if ((int) $listing->book->id === (int) $book->id) {
                return $listing;
            }
        }

        return null;
    }

    public function apiIdForListing(AddressBookListing $listing): string
    {
        if ($listing->isSharee) {
            return AddressBookCollectionUris::sharedApiId((int) $listing->book->id);
        }

        return $this->ownerApiId($listing->book);
    }

    public function ownerApiId(Addressbook $book): string
    {
        $principalUri = (string) $book->principaluri;
        if (str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return AddressBookCollectionUris::groupApiId(
                substr($principalUri, strlen(AdminConstants::GROUP_PREFIX)),
            );
        }

        return (string) $book->uri;
    }

    public function viewerApiId(string $username, Addressbook $book): string
    {
        $listing = $this->listingForBook($username, $book);

        return $listing !== null ? $this->apiIdForListing($listing) : $this->ownerApiId($book);
    }

    public function assertWritable(string $username, Addressbook $book): void
    {
        $listing = $this->listingForBook($username, $book);
        if ($listing === null) {
            throw new ApiHttpException(404, 'Address book not found.', 'not_found');
        }
        if ($listing->isReadOnly()) {
            throw new ApiHttpException(403, 'This address book is read-only.', 'forbidden');
        }
    }

    public function dismissIfSharee(string $username, AddressBookListing $listing): bool
    {
        if (! $listing->isSharee) {
            return false;
        }

        $this->shareVisibility->dismiss($username, (int) $listing->book->id);

        return true;
    }

    /**
     * @return Collection<int, Addressbook>
     */
    private function ownedBooks(string $username)
    {
        $uris = [$this->principalUri($username)];
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $uris[] = AdminConstants::GROUP_PREFIX.$slug;
        }

        return Addressbook::query()
            ->whereIn('principaluri', $uris)
            ->orderBy('id')
            ->get();
    }

    /**
     * @return list<string>
     */
    private function shareePrincipalUris(string $username): array
    {
        $uris = [$this->principalUri($username)];
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $uris[] = AdminConstants::GROUP_PREFIX.$slug;
        }

        return $uris;
    }

    private function ensureVisible(string $username): void
    {
        $this->provisioner->ensureForPrincipal(
            $this->principalUri($username),
            AddressBookCollectionUris::PERSONAL_DISPLAY_NAME,
        );

        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $groupUri = AdminConstants::GROUP_PREFIX.$slug;
            $group = Principal::query()->where('uri', $groupUri)->first(['uri', 'displayname']);
            if ($group === null) {
                continue;
            }
            $this->provisioner->ensureForGroupPrincipal(
                (string) $group->uri,
                (string) ($group->displayname ?? $slug),
            );
        }
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }
}
