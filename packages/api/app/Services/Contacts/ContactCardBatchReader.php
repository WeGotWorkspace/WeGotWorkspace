<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Exceptions\ApiHttpException;
use App\Models\Addressbook;
use App\Models\Card;
use App\Models\JmapContactState;
use App\Services\VObject\VObjectPayloadGuard;

/**
 * Chunked ContactCard/get reads behind {@see ContactCardRepository::showEach()}.
 */
final class ContactCardBatchReader
{
    /** Cards looked up (without their vCard bytes) per query in {@see each()}. */
    private const LOOKUP_CHUNK = 100;

    /** The vCard bytes loaded per query in {@see each()}: at most this many cards or bytes (a lone larger card goes alone). */
    private const GET_BATCH_CARDS = 50;

    private const GET_BATCH_BYTES = 262_144;

    public function __construct(
        private readonly ContactCardMapper $mapper,
        private readonly AddressBookRepository $books,
        private readonly JmapContactStateService $contactStates,
    ) {}

    /**
     * Cards by id for ContactCard/get: the address-book access lookup is read once
     * for the request, cards load in small chunks (one query and one batched state
     * row read per chunk), and each card is yielded as it is mapped, so the caller
     * can project it and drop the rest. Yields the requested id => the card, or
     * null when it is missing, not accessible or over the payload bound.
     *
     * @param  list<string>  $cardIds
     * @param  \Closure(string): ?Card  $findOwnedCard  resolves a card the chunk lookup missed
     * @return \Generator<string, array<string, mixed>|null>
     */
    public function each(string $username, array $cardIds, bool $withMedia, \Closure $findOwnedCard): \Generator
    {
        $books = $this->books->accessibleBooksByNumericId($username);
        $bookIds = array_keys($books);
        foreach (array_chunk($cardIds, self::LOOKUP_CHUNK) as $chunk) {
            $wanted = [];
            foreach ($chunk as $cardId) {
                $wanted[$cardId] = ContactCardMapper::cardUriFromId($cardId);
            }
            // Phase 1: the rows without the vCard bytes, so the lookup of a whole chunk is cheap.
            $found = $bookIds === [] ? [] : Card::query()
                ->select(['id', 'addressbookid', 'uri', 'etag', 'lastmodified', 'size'])
                ->whereIn('addressbookid', $bookIds)
                ->whereIn('uri', array_values(array_unique([...array_keys($wanted), ...array_values($wanted)])))
                ->orderBy('id')
                ->get()
                ->unique(static fn (Card $card): string => (string) $card->uri)
                ->keyBy(static fn (Card $card): string => (string) $card->uri);

            $light = [];
            $entries = [];
            foreach ($wanted as $cardId => $cardUri) {
                // The lowest row wins, as the one-card lookup's first() did.
                $a = $found[$cardId] ?? null;
                $b = $found[$cardUri] ?? null;
                $card = $a !== null && $b !== null ? ((int) $a->id <= (int) $b->id ? $a : $b) : ($a ?? $b);
                if ($card === null) {
                    // SQL matches case-insensitively where the map does not: resolve as show() does.
                    $card = $findOwnedCard($cardId);
                }
                if ($card === null || ! isset($books[(int) $card->addressbookid])) {
                    continue;
                }
                $light[$cardId] = $card;
                $entries[] = ['card' => $card, 'addressBookUri' => $books[(int) $card->addressbookid]['apiId']];
            }
            $states = $this->contactStates->ensureStateRows($username, $entries);
            unset($found, $entries);

            // Phase 2: the vCard bytes in batches bounded by their size, so a chunk of
            // cards with large photos never sits in memory whole. Cards are handed out
            // in request order, each as soon as it is mapped.
            $full = [];
            foreach ($chunk as $position => $cardId) {
                if (! isset($light[$cardId])) {
                    yield $cardId => null;

                    continue;
                }
                if (! isset($full[$cardId])) {
                    $full = $this->loadCardBatch($chunk, $position, $light);
                }
                $card = $full[$cardId] ?? null;
                unset($full[$cardId]);
                yield $cardId => $card === null ? null : $this->mapOne($username, $card, $books, $states, $withMedia);
            }
        }
    }

    /**
     * The next batch of full cards from $position on, up to GET_BATCH_CARDS cards or
     * GET_BATCH_BYTES of vCard (a lone larger card goes alone). Keyed by request id.
     *
     * @param  list<string>  $chunk
     * @param  array<string, Card>  $light  rows without carddata, by request id
     * @return array<string, Card>
     */
    private function loadCardBatch(array $chunk, int $position, array $light): array
    {
        $batch = [];
        $bytes = 0;
        for ($i = $position, $n = count($chunk); $i < $n && count($batch) < self::GET_BATCH_CARDS; $i++) {
            $cardId = $chunk[$i];
            if (! isset($light[$cardId])) {
                continue;
            }
            $size = (int) $light[$cardId]->size;
            if ($batch !== [] && $bytes + $size > self::GET_BATCH_BYTES) {
                break;
            }
            $batch[$cardId] = (int) $light[$cardId]->id;
            $bytes += $size;
        }
        // Eloquent models of the previous batch are cyclic garbage: collect them now, or a page
        // of large vCards piles up until the end of the request (measured: 59 MB against 2 MB).
        gc_collect_cycles();
        $rows = Card::query()->whereIn('id', array_values($batch))->get()->keyBy(static fn (Card $card): int => (int) $card->id);
        $full = [];
        foreach ($batch as $cardId => $rowId) {
            if (isset($rows[$rowId])) {
                $full[$cardId] = $rows[$rowId];
            }
        }

        return $full;
    }

    /**
     * @param  array<int, array{book: Addressbook, apiId: string}>  $books
     * @param  array<string, JmapContactState>  $states
     * @return array<string, mixed>|null
     */
    private function mapOne(string $username, Card $card, array $books, array $states, bool $withMedia): ?array
    {
        try {
            return $this->mapper->toContactCard(
                $card,
                $books[(int) $card->addressbookid]['apiId'],
                $username,
                $withMedia,
                $states[ContactCardMapper::cardIdFromUri((string) $card->uri)] ?? null,
            );
        } catch (ApiHttpException $e) {
            if ($e->getStatusCode() === 404 || VObjectPayloadGuard::isPayloadBoundError($e)) {
                return null;
            }
            throw $e;
        }
    }
}
