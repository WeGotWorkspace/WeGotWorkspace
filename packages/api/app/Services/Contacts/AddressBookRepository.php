<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Dav\Server\WgwCardBackend;
use App\Exceptions\ApiHttpException;
use App\Models\Addressbook;
use Illuminate\Support\Facades\DB;
use Sabre\CardDAV\Plugin as CardDAVPlugin;
use Sabre\DAV\PropPatch;

final class AddressBookRepository
{
    public function __construct(
        private readonly AddressBookCollectionAccess $collectionAccess,
        private readonly AddressBookShareInvites $shareInvites,
    ) {}

    /**
     * @return array{list: list<array<string, mixed>>}
     */
    public function list(string $username): array
    {
        return [
            'list' => array_map(
                fn (AddressBookListing $listing): array => $this->mapListing($listing),
                $this->collectionAccess->accessibleListings($username),
            ),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function show(string $username, string $addressBookId): array
    {
        return $this->mapListing($this->requireListing($username, $addressBookId));
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function create(string $username, array $payload): array
    {
        throw new ApiHttpException(403, 'Creating address books is not allowed.', 'forbidden');
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function update(string $username, string $addressBookId, array $payload): array
    {
        return DB::connection('wgw')->transaction(function () use ($username, $addressBookId, $payload): array {
            $this->collectionAccess->restoreWhenSubscribing($username, $addressBookId, $payload);
            $listing = $this->requireListing($username, $addressBookId);

            if (array_key_exists('name', $payload)) {
                throw new ApiHttpException(403, 'Address book names cannot be changed.', 'forbidden');
            }

            if ($listing->isSharee) {
                $this->assertShareePatchAllowed($payload);
                if (($payload['isSubscribed'] ?? null) === false) {
                    $this->collectionAccess->dismissIfSharee($username, $listing);
                }

                return $this->mapListing($listing);
            }

            if (array_key_exists('shareWith', $payload)) {
                if (! $this->shareInvites->canShare($listing)) {
                    throw new ApiHttpException(403, 'Only collection administrators can change sharing.', 'forbidden');
                }
                $this->shareInvites->apply($listing->book, $payload['shareWith'], $username);
            }

            $mutations = [];
            if (array_key_exists('description', $payload)) {
                $description = $payload['description'];
                $mutations['{'.CardDAVPlugin::NS_CARDDAV.'}addressbook-description'] = is_string($description)
                    ? $description
                    : null;
            }

            if ($mutations !== []) {
                $propPatch = new PropPatch($mutations);
                $this->cardBackend()->updateAddressBook((string) $listing->book->id, $propPatch);
                $propPatch->commit();
            }

            $listing->book->refresh();

            return $this->mapListing($this->requireListing($username, $addressBookId));
        });
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array{ok: true}
     */
    public function delete(string $username, string $addressBookId, array $options = []): array
    {
        $listing = $this->requireListing($username, $addressBookId);

        if ($this->collectionAccess->dismissIfSharee($username, $listing)) {
            return ['ok' => true];
        }

        throw new ApiHttpException(403, 'Address books cannot be deleted.', 'forbidden');
    }

    /**
     * Current Sabre sync token per visible address book JMAP id — the contacts
     * analog of CalendarEventRepository::calendarSyncTokens(), feeding the
     * JMAP envelope's account-wide state codec.
     *
     * @return array<string, string>
     */
    public function syncTokens(string $username): array
    {
        $tokens = [];
        foreach ($this->collectionAccess->accessibleListings($username) as $listing) {
            $tokens[$this->collectionAccess->apiIdForListing($listing)] = (string) (int) ($listing->book->synctoken ?? 1);
        }

        return $tokens;
    }

    public function requireAccessibleBook(string $username, string $addressBookId): Addressbook
    {
        return $this->requireListing($username, $addressBookId)->book;
    }

    public function requireListing(string $username, string $addressBookId): AddressBookListing
    {
        $listing = $this->collectionAccess->listingFor($username, $addressBookId);
        if ($listing !== null) {
            return $listing;
        }

        throw new ApiHttpException(404, 'Address book not found.', 'not_found');
    }

    public function apiIdFor(Addressbook $book): string
    {
        return $this->collectionAccess->ownerApiId($book);
    }

    public function viewerApiId(string $username, Addressbook $book): string
    {
        return $this->collectionAccess->viewerApiId($username, $book);
    }

    public function assertWritable(string $username, Addressbook $book): void
    {
        $this->collectionAccess->assertWritable($username, $book);
    }

    /**
     * @return list<int>
     */
    public function accessibleBookNumericIds(string $username): array
    {
        return array_map(
            static fn (AddressBookListing $listing): int => (int) $listing->book->id,
            $this->collectionAccess->accessibleListings($username),
        );
    }

    /** @param array<string, mixed> $payload */
    private function assertShareePatchAllowed(array $payload): void
    {
        $disallowed = [];
        foreach (['description', 'shareWith'] as $key) {
            if (array_key_exists($key, $payload)) {
                $disallowed[] = $key;
            }
        }
        if ($disallowed !== []) {
            throw new ApiHttpException(403, 'Sharees cannot change owner address book fields.', 'forbidden');
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function mapListing(AddressBookListing $listing): array
    {
        $book = $listing->book;
        $id = $this->collectionAccess->apiIdForListing($listing);
        $isDefault = ! $listing->isSharee && $id === AddressBookCollectionUris::PERSONAL_DEFAULT;
        $name = trim((string) ($book->displayname ?? ''));
        if ($isDefault) {
            $name = AddressBookCollectionUris::PERSONAL_DISPLAY_NAME;
        } elseif ($name === '') {
            $name = $id;
        }

        return [
            'id' => $id,
            'name' => $name,
            'description' => is_string($book->description) && trim($book->description) !== ''
                ? trim($book->description)
                : null,
            'sortOrder' => (int) ($book->id ?? 0),
            'isDefault' => $isDefault,
            'isSubscribed' => true,
            'isSharee' => $listing->isSharee,
            'shareWith' => $listing->isSharee ? null : $this->shareInvites->shareWithForOwner($book),
            'myRights' => $listing->rights(),
        ];
    }

    private function cardBackend(): WgwCardBackend
    {
        return WgwCardBackend::fromConnection();
    }
}
