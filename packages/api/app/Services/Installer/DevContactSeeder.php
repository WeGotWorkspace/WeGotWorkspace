<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Models\Addressbook;
use App\Models\Card;
use App\Models\JmapContactState;
use App\Models\User;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\AddressBookProvisioner;
use App\Services\Contacts\ContactCardMapper;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Sabre\CardDAV\Backend\PDO as CardPDO;

/**
 * Writes deterministic vCard 4.0 cards into a local-dev user's personal address book.
 *
 * Uses CardDAV PDO (not ContactCardRepository) so ~1000 creates stay fast.
 * Search indexing and mutation events are skipped on create. JMAP state rows
 * appear on first read. --force deletes through CardPDO::deleteCard and clears
 * leftover state rows so a recreated card does not keep a stale state token.
 */
class DevContactSeeder
{
    public function __construct(
        private readonly DevContactCatalog $catalog,
        private readonly AddressBookProvisioner $books,
        private readonly BestEffortSearchIndexSync $searchIndexSync,
        private readonly SearchIndexerService $searchIndexer,
        private readonly DevSeedGuard $guard,
    ) {}

    public function isAllowed(): bool
    {
        return $this->guard->isAllowed();
    }

    /**
     * @return array{created: int, skipped: int, deleted: int}
     */
    public function seed(
        string $username,
        string $profile = DevContactCatalog::PROFILE_FULL,
        bool $force = false,
        ?int $count = null,
    ): array {
        $this->guard->assertAllowed('contacts');

        $username = strtolower(trim($username));
        if ($username === '' || User::query()->where('username', $username)->doesntExist()) {
            throw new RuntimeException('Cannot seed contacts: user '.$username.' was not found.');
        }

        $cards = $this->catalog->cards($profile, $count);

        return DB::connection('wgw')->transaction(function () use ($username, $cards, $force): array {
            $this->books->ensureForPrincipal('principals/'.$username, $username);
            $book = $this->personalBook($username);

            $deleted = 0;
            if ($force) {
                $deleted = $this->deleteSeededCards($username);
            }

            $created = 0;
            $skipped = 0;
            foreach ($cards as $card) {
                if (! $force && $this->cardExists((int) $book->id, $card['uri'])) {
                    $skipped++;

                    continue;
                }

                $this->carddav()->createCard((int) $book->id, $card['uri'], $card['vcard']);
                $created++;
            }

            return [
                'created' => $created,
                'skipped' => $skipped,
                'deleted' => $deleted,
            ];
        });
    }

    /**
     * Deletes dev-seed cards and the derived rows CardPDO::deleteCard leaves behind.
     * Tests call this on its own. seed() keeps it inside the same transaction as recreate.
     */
    protected function deleteSeededCards(string $username): int
    {
        $book = Addressbook::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('uri', AddressBookCollectionUris::CALDAV_URI)
            ->first();
        if ($book === null) {
            return 0;
        }

        $cards = Card::query()
            ->where('addressbookid', $book->id)
            ->where('uri', 'like', DevContactCatalog::URI_PREFIX.'%')
            ->get();

        $deleted = 0;
        foreach ($cards as $card) {
            $uri = (string) $card->uri;
            $this->carddav()->deleteCard((int) $book->id, $uri);
            JmapContactState::query()
                ->where('username', $username)
                ->where('card_id', ContactCardMapper::cardIdFromUri($uri))
                ->delete();
            $davPath = 'addressbooks/'.$username.'/'.$book->uri.'/'.$uri;
            $this->searchIndexSync->sync(
                'contacts',
                fn () => $this->searchIndexer->deleteDavPath($davPath),
                $davPath,
                $username,
            );
            $deleted++;
        }

        return $deleted;
    }

    private function cardExists(int $addressBookId, string $uri): bool
    {
        return Card::query()
            ->where('addressbookid', $addressBookId)
            ->where('uri', $uri)
            ->exists();
    }

    private function personalBook(string $username): Addressbook
    {
        $book = Addressbook::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('uri', AddressBookCollectionUris::CALDAV_URI)
            ->first();
        if ($book === null) {
            throw new RuntimeException('Personal address book was not found for '.$username.'.');
        }

        return $book;
    }

    private function carddav(): CardPDO
    {
        return new CardPDO(DB::connection('wgw')->getPdo());
    }
}
