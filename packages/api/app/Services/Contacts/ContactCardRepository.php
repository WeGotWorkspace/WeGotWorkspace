<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;
use App\Models\Addressbook;
use App\Models\Card;
use App\Services\Contacts\Conversion\ContactCardVcfImportSupport;
use App\Services\Contacts\Conversion\ConversionSupport;
use App\Services\Contacts\Conversion\VCardJsContactConverter;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CardDAV\Backend\PDO as CardPDO;

final class ContactCardRepository
{
    public function __construct(
        private readonly ContactCardMapper $mapper,
        private readonly SearchIndexerService $searchIndexer,
        private readonly VCardJsContactConverter $vcardConverter,
        private readonly BestEffortSearchIndexSync $searchIndexSync,
        private readonly JmapContactStateService $contactStates,
        private readonly AddressBookRepository $books,
    ) {}

    /**
     * @return array{list: list<array<string, mixed>>}
     */
    public function list(string $username, string $addressBookId, ?string $uid = null): array
    {
        $book = $this->books->requireAccessibleBook($username, $addressBookId);
        $bookApiId = $this->books->viewerApiId($username, $book);

        $cards = Card::query()
            ->where('addressbookid', (int) $book->id)
            ->orderBy('uri')
            ->get();

        $list = [];
        foreach ($cards as $card) {
            if ($uid !== null && $this->extractUid($card) !== $uid) {
                continue;
            }
            $list[] = $this->mapper->toContactCard($card, $bookApiId, $username);
        }

        return ['list' => $list];
    }

    /**
     * @param  array<string, mixed>  $filter
     * @return array{ids: list<string>, total: int}
     */
    public function query(string $username, array $filter, ?int $limit = null): array
    {
        $addressBookId = $filter['inAddressBook'] ?? null;
        if (! is_string($addressBookId) || trim($addressBookId) === '') {
            throw new ApiHttpException(400, 'filter.inAddressBook is required.', 'bad_request');
        }

        $book = $this->books->requireAccessibleBook($username, $addressBookId);

        $uidFilter = isset($filter['uid']) && is_string($filter['uid']) ? $filter['uid'] : null;

        $cards = Card::query()
            ->where('addressbookid', (int) $book->id)
            ->orderBy('uri')
            ->get();

        $ids = [];
        $total = 0;
        foreach ($cards as $card) {
            if ($uidFilter !== null && $this->extractUid($card) !== $uidFilter) {
                continue;
            }
            $total++;
            if ($limit === null || count($ids) < $limit) {
                $ids[] = ContactCardMapper::cardIdFromUri((string) $card->uri);
            }
        }

        return [
            'ids' => $ids,
            'total' => $total,
        ];
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
    public function changes(string $username, string $addressBookId, ?string $since): array
    {
        $book = $this->books->requireAccessibleBook($username, $addressBookId);

        $syncToken = ($since === null || $since === '' || $since === '0') ? null : $since;
        $changes = $this->cardBackend()->getChangesForAddressBook((int) $book->id, $syncToken, 1);
        if ($changes === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        return [
            'oldState' => $since ?? '0',
            'newState' => (string) $changes['syncToken'],
            'created' => $this->mapChangeUris($changes['added'] ?? []),
            'updated' => $this->mapChangeUris($changes['modified'] ?? []),
            'destroyed' => $this->mapChangeUris($changes['deleted'] ?? []),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function show(string $username, string $cardId): array
    {
        $located = $this->findOwnedCard($username, $cardId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Contact card not found.', 'not_found');
        }

        return $this->mapper->toContactCard($located['card'], $located['bookApiId'], $username);
    }

    /**
     * Import one or more vCard blocks from a file. Contacts are created before groups so
     * member uids from the same file resolve when groups are persisted.
     *
     * @return array{list: list<array<string, mixed>>, errors: list<array{index: int, message: string}>}
     */
    public function importVcards(string $username, string $vcardText, string $addressBookId): array
    {
        $book = $this->books->requireAccessibleBook($username, $addressBookId);
        $this->books->assertWritable($username, $book);

        $chunks = ContactCardVcfImportSupport::splitVcards($vcardText);
        if ($chunks === []) {
            throw new ApiHttpException(400, 'No vCard data found.', 'bad_request');
        }

        $individuals = [];
        $groups = [];
        $errors = [];

        foreach ($chunks as $index => $chunk) {
            try {
                $card = $this->vcardConverter->cardFromVCard($chunk);
                if (ContactCardVcfImportSupport::isGroupCard($card)) {
                    $groups[] = $card;
                } else {
                    $individuals[] = $card;
                }
            } catch (\Throwable) {
                $errors[] = ['index' => $index, 'message' => 'Invalid vCard block.'];
            }
        }

        $created = [];
        $bookApiId = $this->books->viewerApiId($username, $book);

        foreach ([...$individuals, ...$groups] as $card) {
            try {
                $payload = ContactCardVcfImportSupport::createPayload($card, $bookApiId);
                $created[] = $this->create($username, $payload);
            } catch (\Throwable) {
                $errors[] = [
                    'index' => count($created) + count($errors),
                    'message' => 'Could not import contact.',
                ];
            }
        }

        // Re-read group cards after the full batch is persisted so member uids from
        // the same import (or contacts imported earlier in this request) resolve.
        foreach ($created as $index => $card) {
            if (($card['kind'] ?? null) !== 'group') {
                continue;
            }
            $cardId = $card['id'] ?? null;
            if (! is_string($cardId) || $cardId === '') {
                continue;
            }
            $created[$index] = $this->show($username, $cardId);
        }

        return ['list' => $created, 'errors' => $errors];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function create(string $username, array $payload): array
    {
        $book = $this->resolveAddressBookFromPayload($username, $payload);
        $this->books->assertWritable($username, $book);
        $cardPayload = $this->normalizeCardPayload($payload);
        $cardUri = $this->allocateCardUri((int) $book->id, $cardPayload);
        $vcard = $this->mapper->toVCard($username, $cardPayload);

        $this->cardBackend()->createCard((int) $book->id, $cardUri, $vcard);
        $davPath = $this->cardDavPathFor($book, $cardUri);
        $this->searchIndexSync->sync(
            'contacts',
            fn () => $this->searchIndexer->indexCardObjectFromPath($davPath),
            $davPath,
            $username,
        );

        $card = $this->findCardInBook((int) $book->id, $cardUri);
        if ($card === null) {
            throw new ApiHttpException(500, 'Could not load created contact card.', 'server_error');
        }

        return $this->mapper->toContactCard($card, $this->books->viewerApiId($username, $book), $username);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function update(
        string $username,
        string $cardId,
        array $payload,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
    ): array {
        $located = $this->findOwnedCard($username, $cardId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Contact card not found.', 'not_found');
        }

        $this->assertCardPreconditions($located['card'], $ifMatch, $ifUnmodifiedSince, true);

        $book = $located['book'];
        $this->books->assertWritable($username, $book);
        $card = $located['card'];
        $cardUri = (string) $card->uri;
        $bookApiId = $located['bookApiId'];
        $existingContact = $this->mapper->toContactCard($card, $bookApiId, $username);
        $cardPayload = $this->normalizeCardPayload($payload, $existingContact);
        $cardPayload['id'] = ContactCardMapper::cardIdFromUri($cardUri);
        $cardPayload['addressBookIds'] = [$bookApiId => true];

        $vcard = $this->mapper->toVCard($username, $cardPayload);
        $addressBookId = (int) $card->addressbookid;
        $this->cardBackend()->updateCard($addressBookId, $cardUri, $vcard);
        $davPath = $this->cardDavPathFor($book, $cardUri);
        $this->searchIndexSync->sync(
            'contacts',
            fn () => $this->searchIndexer->indexCardObjectFromPath($davPath),
            $davPath,
            $username,
        );

        $updated = $this->findCardInBook($addressBookId, $cardUri);
        if ($updated === null) {
            throw new ApiHttpException(500, 'Could not load updated contact card.', 'server_error');
        }

        return $this->mapper->toContactCard($updated, $bookApiId, $username);
    }

    /**
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public function patch(
        string $username,
        string $cardId,
        array $patch,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
    ): array {
        return $this->patchWithPrecondition(
            $username,
            $cardId,
            $patch,
            $ifMatch,
            $ifUnmodifiedSince,
            true,
        );
    }

    /**
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public function patchWithPrecondition(
        string $username,
        string $cardId,
        array $patch,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        $located = $this->findOwnedCard($username, $cardId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Contact card not found.', 'not_found');
        }

        $this->assertCardPreconditions($located['card'], $ifMatch, $ifUnmodifiedSince, $requirePrecondition);

        $book = $located['book'];
        $this->books->assertWritable($username, $book);
        $card = $located['card'];
        $cardUri = (string) $card->uri;
        $bookApiId = $located['bookApiId'];
        $existingContact = $this->mapper->toContactCard($card, $bookApiId, $username);
        $merged = ConversionSupport::deepMergeContactCardPatch($existingContact, $patch);
        $cardPayload = $this->normalizeCardPayload($merged, $existingContact);
        $cardPayload['id'] = ContactCardMapper::cardIdFromUri($cardUri);

        $destination = $this->resolvePatchDestinationBook($username, $cardPayload, $bookApiId, $book);
        if ($destination !== null) {
            return $this->moveCardToAddressBook(
                $username,
                $card,
                $book,
                $destination,
                $cardPayload,
                $existingContact,
            );
        }

        $cardPayload['addressBookIds'] = [$bookApiId => true];
        $vcard = $this->mapper->toVCard($username, $cardPayload);
        $addressBookId = (int) $card->addressbookid;
        $this->cardBackend()->updateCard($addressBookId, $cardUri, $vcard);
        $davPath = $this->cardDavPathFor($book, $cardUri);
        $this->searchIndexSync->sync(
            'contacts',
            fn () => $this->searchIndexer->indexCardObjectFromPath($davPath),
            $davPath,
            $username,
        );

        $updated = $this->findCardInBook($addressBookId, $cardUri);
        if ($updated === null) {
            throw new ApiHttpException(500, 'Could not load patched contact card.', 'server_error');
        }

        return $this->mapper->toContactCard($updated, $bookApiId, $username);
    }

    /**
     * Export a download-ready vCard for the given card.
     *
     * Re-serializes through JSContact so write-side Apple labels (`itemN.X-ABLabel`)
     * and other normalizations apply even when stored `carddata` is stale (e.g.
     * CardDAV uploads or cards written before X-ABLabel emission). Does not mutate
     * storage — CardDAV clients still see the stored bytes until the next write.
     *
     * @return array{carddata: string, uri: string}
     */
    public function exportVcard(string $username, string $cardId): array
    {
        $located = $this->findOwnedCard($username, $cardId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Contact card not found.', 'not_found');
        }

        $carddata = $located['card']->carddata;
        if (! is_string($carddata) || $carddata === '') {
            throw new ApiHttpException(404, 'Contact card has no vCard data.', 'not_found');
        }

        $card = $this->vcardConverter->cardFromVCard($carddata);

        return [
            'carddata' => $this->vcardConverter->vCardFromCard($card),
            'uri' => (string) $located['card']->uri,
        ];
    }

    /**
     * @return array{ok: true}
     */
    public function delete(
        string $username,
        string $cardId,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
    ): array {
        return $this->deleteWithPrecondition($username, $cardId, $ifMatch, $ifUnmodifiedSince, true);
    }

    /**
     * @return array{ok: true}
     */
    public function deleteWithPrecondition(
        string $username,
        string $cardId,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        $located = $this->findOwnedCard($username, $cardId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Contact card not found.', 'not_found');
        }

        $this->assertCardPreconditions($located['card'], $ifMatch, $ifUnmodifiedSince, $requirePrecondition);

        $book = $located['book'];
        $this->books->assertWritable($username, $book);
        $card = $located['card'];
        $cardUri = (string) $card->uri;
        $this->cardBackend()->deleteCard((int) $card->addressbookid, $cardUri);
        $davPath = $this->cardDavPathFor($book, $cardUri);
        $this->searchIndexSync->sync(
            'contacts',
            fn () => $this->searchIndexer->deleteDavPath($davPath),
            $davPath,
            $username,
        );

        $this->contactStates->deleteForCard($username, $cardId);

        return ['ok' => true];
    }

    /**
     * @param  array<string, mixed>  $cardPayload
     * @param  array<string, mixed>  $existingContact
     * @return array<string, mixed>
     */
    private function moveCardToAddressBook(
        string $username,
        Card $card,
        Addressbook $sourceBook,
        Addressbook $destinationBook,
        array $cardPayload,
        array $existingContact,
    ): array {
        $this->books->assertWritable($username, $destinationBook);
        if (ContactCardVcfImportSupport::isGroupCard($existingContact)) {
            throw new ApiHttpException(400, 'Contact groups cannot be moved between address books.', 'bad_request');
        }

        $destApiId = $this->books->viewerApiId($username, $destinationBook);
        $cardPayload['addressBookIds'] = [$destApiId => true];
        $cardUri = (string) $card->uri;
        $sourceId = (int) $sourceBook->id;
        $destId = (int) $destinationBook->id;
        if ($this->findCardInBook($destId, $cardUri) !== null) {
            throw new ApiHttpException(
                409,
                'A contact with this URI already exists in the destination address book.',
                'alreadyExists',
            );
        }

        $vcard = $this->mapper->toVCard($username, $cardPayload);
        DB::connection('wgw')->transaction(function () use (
            $username,
            $sourceBook,
            $existingContact,
            $cardUri,
            $sourceId,
            $destId,
            $vcard,
        ): void {
            $this->dropSourceBookGroupMemberships($username, $sourceBook, $existingContact, $cardUri);
            $this->cardBackend()->createCard($destId, $cardUri, $vcard);
            $this->cardBackend()->deleteCard($sourceId, $cardUri);
        });

        $oldPath = $this->cardDavPathFor($sourceBook, $cardUri);
        $newPath = $this->cardDavPathFor($destinationBook, $cardUri);
        $this->searchIndexSync->sync(
            'contacts',
            fn () => $this->searchIndexer->deleteDavPath($oldPath),
            $oldPath,
            $username,
        );
        $this->searchIndexSync->sync(
            'contacts',
            fn () => $this->searchIndexer->indexCardObjectFromPath($newPath),
            $newPath,
            $username,
        );

        $moved = $this->findCardInBook($destId, $cardUri);
        if ($moved === null) {
            throw new ApiHttpException(500, 'Could not load moved contact card.', 'server_error');
        }

        return $this->mapper->toContactCard($moved, $destApiId, $username);
    }

    /**
     * @param  array<string, mixed>  $cardPayload
     */
    private function resolvePatchDestinationBook(
        string $username,
        array $cardPayload,
        string $sourceApiId,
        Addressbook $sourceBook,
    ): ?Addressbook {
        $ids = $cardPayload['addressBookIds'] ?? null;
        if (! is_array($ids)) {
            return null;
        }

        $enabled = [];
        foreach ($ids as $id => $flag) {
            if ($flag === true) {
                $enabled[] = (string) $id;
            }
        }

        if ($enabled === []) {
            throw new ApiHttpException(400, 'addressBookIds must include one address book.', 'bad_request');
        }

        $destIds = array_values(array_filter(
            $enabled,
            static fn (string $id): bool => $id !== $sourceApiId,
        ));
        if (count($destIds) > 1) {
            throw new ApiHttpException(400, 'A contact can belong to only one address book.', 'bad_request');
        }
        if ($destIds === []) {
            return null;
        }

        $destination = $this->books->requireAccessibleBook($username, $destIds[0]);
        if ((int) $destination->id === (int) $sourceBook->id) {
            return null;
        }

        return $destination;
    }

    /**
     * @param  array<string, mixed>  $movingContact
     */
    private function dropSourceBookGroupMemberships(
        string $username,
        Addressbook $sourceBook,
        array $movingContact,
        string $movingCardUri,
    ): void {
        $uid = $movingContact['uid'] ?? null;
        if (! is_string($uid) || $uid === '') {
            return;
        }

        $normalizedUid = ConversionSupport::normalizeContactUidForMatch($uid);
        $groups = Card::query()
            ->where('addressbookid', (int) $sourceBook->id)
            ->where('uri', '!=', $movingCardUri)
            ->get();

        foreach ($groups as $groupCard) {
            $raw = is_string($groupCard->carddata) ? $groupCard->carddata : (string) $groupCard->carddata;
            if ($raw === '') {
                continue;
            }

            try {
                $parsed = $this->vcardConverter->cardFromVCard($raw);
            } catch (\Throwable) {
                continue;
            }

            if (! ContactCardVcfImportSupport::isGroupCard($parsed)) {
                continue;
            }

            $members = $parsed['members'] ?? null;
            if (! is_array($members)) {
                continue;
            }

            $changed = false;
            foreach (array_keys($members) as $memberUid) {
                if (ConversionSupport::normalizeContactUidForMatch((string) $memberUid) !== $normalizedUid) {
                    continue;
                }
                unset($members[$memberUid]);
                $changed = true;
            }

            if (! $changed) {
                continue;
            }

            $parsed['members'] = $members;
            $parsed['id'] = ContactCardMapper::cardIdFromUri((string) $groupCard->uri);
            $vcard = $this->mapper->toVCard($username, $this->normalizeCardPayload($parsed, $parsed));
            $this->cardBackend()->updateCard((int) $sourceBook->id, (string) $groupCard->uri, $vcard);
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function resolveAddressBookFromPayload(string $username, array $payload): Addressbook
    {
        $addressBookIds = $payload['addressBookIds'] ?? null;
        if (! is_array($addressBookIds) || $addressBookIds === []) {
            throw new ApiHttpException(400, 'addressBookIds is required.', 'bad_request');
        }

        $bookUri = null;
        foreach ($addressBookIds as $id => $enabled) {
            if ($enabled === true) {
                $bookUri = (string) $id;
                break;
            }
        }

        if ($bookUri === null || $bookUri === '') {
            throw new ApiHttpException(400, 'addressBookIds is required.', 'bad_request');
        }

        return $this->books->requireAccessibleBook($username, $bookUri);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>|null  $existingCard
     * @return array<string, mixed>
     */
    private function normalizeCardPayload(array $payload, ?array $existingCard = null): array
    {
        $card = $payload;
        unset($card['id']);

        if (! isset($card['@type']) || ! is_string($card['@type'])) {
            $card['@type'] = 'Card';
        }
        if (! isset($card['version']) || ! is_string($card['version'])) {
            $card['version'] = '1.0';
        }
        if (! isset($card['uid']) || ! is_string($card['uid']) || trim($card['uid']) === '') {
            $card['uid'] = 'urn:uuid:'.Str::uuid()->toString();
        }

        return ConversionSupport::normalizeCardMapKeys($card, $existingCard);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function allocateCardUri(int $addressBookId, array $payload): string
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $candidate = ContactCardMapper::generateCardUri($payload);
            if ($this->findCardInBook($addressBookId, $candidate) === null) {
                return $candidate;
            }
        }

        throw new ApiHttpException(500, 'Could not allocate contact card id.', 'server_error');
    }

    /**
     * @return array{card: Card, book: Addressbook, bookApiId: string}|null
     */
    private function findOwnedCard(string $username, string $cardId): ?array
    {
        $cardUri = ContactCardMapper::cardUriFromId($cardId);
        $bookIds = $this->books->accessibleBookNumericIds($username);
        $card = Card::query()
            ->with('addressbook')
            ->where(function ($query) use ($cardId, $cardUri): void {
                $query->where('uri', $cardId)
                    ->orWhere('uri', $cardUri);
            })
            ->whereIn('addressbookid', $bookIds === [] ? [0] : $bookIds)
            ->first();

        if ($card === null || $card->addressbook === null) {
            return null;
        }

        return [
            'card' => $card,
            'book' => $card->addressbook,
            'bookApiId' => $this->books->viewerApiId($username, $card->addressbook),
        ];
    }

    private function findCardInBook(int $addressBookId, string $cardUri): ?Card
    {
        return Card::query()
            ->where('addressbookid', $addressBookId)
            ->where('uri', $cardUri)
            ->first();
    }

    private function cardDavPathFor(Addressbook $book, string $cardUri): string
    {
        $home = preg_replace('#^principals/#', '', (string) $book->principaluri) ?? '';

        return 'addressbooks/'.$home.'/'.$book->uri.'/'.$cardUri;
    }

    private function assertCardPreconditions(
        Card $card,
        ?string $ifMatch,
        ?string $ifUnmodifiedSince,
        bool $requirePrecondition = true,
    ): void {
        OptimisticConcurrency::assertPreconditions(
            $ifMatch,
            $ifUnmodifiedSince,
            is_string($card->etag) ? $card->etag : null,
            (int) ($card->lastmodified ?? 0),
            $requirePrecondition,
        );
    }

    private function cardBackend(): CardPDO
    {
        return new CardPDO(DB::connection('wgw')->getPdo());
    }

    /**
     * @param  list<string>  $uris
     * @return list<string>
     */
    private function mapChangeUris(array $uris): array
    {
        return array_values(array_map(
            fn (string $uri): string => ContactCardMapper::cardIdFromUri($uri),
            $uris,
        ));
    }

    private function extractUid(Card $card): ?string
    {
        $raw = $card->carddata;
        if (! is_string($raw) || $raw === '') {
            return null;
        }

        if (preg_match('/^UID(?:;[^:]*)?:(.+)$/mi', $raw, $matches) !== 1) {
            return null;
        }

        return trim($matches[1]);
    }
}
