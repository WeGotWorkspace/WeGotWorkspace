<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Exceptions\ApiHttpException;
use App\Models\Addressbook;
use App\Services\Admin\AdminConstants;
use Illuminate\Support\Facades\DB;
use Sabre\CardDAV\Backend\PDO as CardPDO;
use Sabre\CardDAV\Plugin as CardDAVPlugin;
use Sabre\DAV\PropPatch;

final class AddressBookRepository
{
    public function __construct(
        private readonly AddressBookCollectionAccess $collectionAccess,
        private readonly AddressBookShareInvites $shareInvites,
        private readonly AddressBookShareVisibility $shareVisibility,
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
        $listing = $this->requireListing($username, $addressBookId);

        if (array_key_exists('name', $payload)) {
            throw new ApiHttpException(403, 'Address book names cannot be changed.', 'forbidden');
        }

        if ($listing->isSharee) {
            $this->assertShareePatchAllowed($payload);
            if (array_key_exists('isSubscribed', $payload)) {
                if ($payload['isSubscribed'] === false) {
                    $this->shareVisibility->dismiss($username, (int) $listing->book->id);
                } elseif ($payload['isSubscribed'] === true) {
                    $this->shareVisibility->restore($username, (int) $listing->book->id);
                }
            }

            $restored = $this->collectionAccess->listingFor($username, $addressBookId);
            if ($restored === null) {
                return $this->mapListing($listing);
            }

            return $this->mapListing($restored);
        }

        if (array_key_exists('shareWith', $payload)) {
            if (! $this->shareInvites->canShare($listing)) {
                throw new ApiHttpException(403, 'Only collection administrators can change sharing.', 'forbidden');
            }
            $this->shareInvites->apply($listing->book, $payload['shareWith']);
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
            $this->cardBackend()->updateAddressBook((int) $listing->book->id, $propPatch);
            $propPatch->commit();
        }

        $listing->book->refresh();

        return $this->mapListing($this->requireListing($username, $addressBookId));
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
     * @return array{
     *     oldState: string,
     *     newState: string,
     *     created: list<string>,
     *     updated: list<string>,
     *     destroyed: list<string>
     * }
     */
    public function changes(string $username, ?string $since): array
    {
        $listings = $this->collectionAccess->accessibleListings($username);

        $currentState = $this->computeBooksState($listings);
        $previous = $this->parseBooksState($since);

        if ($since === null || $since === '' || $since === '0') {
            return [
                'oldState' => '0',
                'newState' => $currentState,
                'created' => array_map(
                    fn (AddressBookListing $listing): string => $this->collectionAccess->apiIdForListing($listing),
                    $listings,
                ),
                'updated' => [],
                'destroyed' => [],
            ];
        }

        if ($since === $currentState) {
            return [
                'oldState' => $since,
                'newState' => $currentState,
                'created' => [],
                'updated' => [],
                'destroyed' => [],
            ];
        }

        if ($previous === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        $currentMap = [];
        foreach ($listings as $listing) {
            $currentMap[$this->collectionAccess->apiIdForListing($listing)] = (int) $listing->book->synctoken;
        }

        $created = [];
        $updated = [];
        foreach ($currentMap as $uri => $token) {
            if (! array_key_exists($uri, $previous)) {
                $created[] = $uri;

                continue;
            }
            if ($previous[$uri] !== $token) {
                $updated[] = $uri;
            }
        }

        $destroyed = [];
        foreach (array_keys($previous) as $uri) {
            if (! array_key_exists($uri, $currentMap)) {
                $destroyed[] = $uri;
            }
        }

        return [
            'oldState' => $since,
            'newState' => $currentState,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
        ];
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

        $slug = AddressBookCollectionUris::parseGroupApiId($addressBookId);
        if ($slug !== null) {
            $exists = Addressbook::query()
                ->where('principaluri', AdminConstants::GROUP_PREFIX.$slug)
                ->where('uri', AddressBookCollectionUris::CALDAV_URI)
                ->exists();
            if ($exists) {
                throw new ApiHttpException(403, 'Not a member of this address book.', 'forbidden');
            }
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
        return array_values(array_map(
            static fn (AddressBookListing $listing): int => (int) $listing->book->id,
            $this->collectionAccess->accessibleListings($username),
        ));
    }

    /**
     * @param  list<string>  $disallowedKeys
     */
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
     * @param  list<AddressBookListing>  $listings
     */
    private function computeBooksState(array $listings): string
    {
        $parts = [];
        foreach ($listings as $listing) {
            $parts[] = $this->collectionAccess->apiIdForListing($listing).':'.(int) $listing->book->synctoken;
        }

        return (string) count($parts).':'.implode(',', $parts);
    }

    /**
     * @return array<string, int>|null
     */
    private function parseBooksState(?string $state): ?array
    {
        if ($state === null || $state === '' || $state === '0') {
            return [];
        }

        if (! preg_match('/^(\d+):(.+)$/', $state, $matches)) {
            return null;
        }

        $expectedCount = (int) $matches[1];
        $entries = $matches[2] === '' ? [] : explode(',', $matches[2]);
        if (count($entries) !== $expectedCount) {
            return null;
        }

        $map = [];
        foreach ($entries as $entry) {
            $parts = explode(':', $entry, 2);
            if (count($parts) !== 2 || $parts[0] === '' || ! ctype_digit($parts[1])) {
                return null;
            }
            $map[$parts[0]] = (int) $parts[1];
        }

        return $map;
    }

    /**
     * @return array<string, mixed>
     */
    private function mapListing(AddressBookListing $listing): array
    {
        $book = $listing->book;
        $id = $this->collectionAccess->apiIdForListing($listing);
        $name = trim((string) ($book->displayname ?? ''));
        if ($name === '') {
            $name = $id;
        }
        $isDefault = ! $listing->isSharee && $id === AddressBookCollectionUris::PERSONAL_DEFAULT;

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

    private function cardBackend(): CardPDO
    {
        return new CardPDO(DB::connection('wgw')->getPdo());
    }
}
