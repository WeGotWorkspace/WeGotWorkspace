<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Dav\Server\WgwCardBackend;
use App\Models\Card;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Fills `cards.uid` and resolves duplicates. The #1609 migration runs it
 * before it adds the unique indexes; it is safe to run again.
 *
 * Rule: per (addressbookid, uid) and per (addressbookid, uri), the card with
 * the lowest id keeps its UID and URI (on a re-run, a card whose column is
 * already filled keeps it). Every other card in the group gets a new
 * `urn:uuid:` UID (or a new URI), written through the CardDAV backend so etag,
 * sync token and `addressbookchanges` move and clients pick it up. A card
 * without a UID gets one the same way. Nothing is deleted.
 */
final class CardUidBackfill
{
    private const CHUNK = 200;

    /**
     * @return array{filled: int, generated: int, reUided: int, reUried: int, skipped: int}
     */
    public function run(): array
    {
        $backend = WgwCardBackend::fromConnection();

        [$filled, $missing, $duplicates] = $this->fillFromCardData();
        // URIs first: the re-UID writes below address cards by URI.
        $reUried = $this->resolveDuplicateUris($backend);
        $generated = $this->reUidAll($backend, $missing);
        $reUided = $this->reUidAll($backend, $duplicates);

        $stats = [
            'filled' => $filled,
            'generated' => $generated,
            'reUided' => $reUided,
            'reUried' => $reUried,
            'skipped' => count($missing) + count($duplicates) - $generated - $reUided,
        ];
        Log::info('contacts.card_uid_backfill', $stats);

        return $stats;
    }

    /**
     * Copy each card's UID into the column, in id order. The vCard itself does
     * not change. A card whose UID is already held in its book is a duplicate.
     *
     * @return array{0: int, 1: list<int>, 2: list<int>} filled count, ids without a UID, ids of duplicates
     */
    private function fillFromCardData(): array
    {
        $filled = 0;
        $missing = [];
        $duplicates = [];
        Card::query()
            ->whereNull('uid')
            ->select(['id', 'addressbookid', 'carddata'])
            ->chunkById(self::CHUNK, function ($cards) use (&$filled, &$missing, &$duplicates): void {
                foreach ($cards as $card) {
                    $uid = CardUid::forCardData(self::cardData($card));
                    if ($uid === null) {
                        $missing[] = (int) $card->id;
                    } elseif (Card::query()->where('addressbookid', $card->addressbookid)->where('uid', $uid)->exists()) {
                        $duplicates[] = (int) $card->id;
                    } else {
                        Card::query()->whereKey($card->id)->update(['uid' => $uid]);
                        $filled++;
                    }
                }
            });

        return [$filled, $missing, $duplicates];
    }

    private function resolveDuplicateUris(WgwCardBackend $backend): int
    {
        $count = 0;
        $groups = Card::query()
            ->select(['addressbookid', 'uri'])
            ->groupBy('addressbookid', 'uri')
            ->havingRaw('COUNT(*) > 1')
            ->get();
        foreach ($groups as $group) {
            $ids = Card::query()
                ->where('addressbookid', $group->addressbookid)
                ->where('uri', $group->uri)
                ->orderBy('id')
                ->pluck('id')
                ->all();
            array_shift($ids);
            foreach ($ids as $cardId) {
                $backend->moveDuplicateUriRow((int) $cardId, Str::uuid()->toString().'.vcf');
                $count++;
            }
        }

        return $count;
    }

    /**
     * @param  list<int>  $cardIds
     * @return int cards re-UIDed
     */
    private function reUidAll(WgwCardBackend $backend, array $cardIds): int
    {
        $count = 0;
        foreach ($cardIds as $cardId) {
            if ($this->reUid($backend, $cardId)) {
                $count++;
            }
        }

        return $count;
    }

    private function reUid(WgwCardBackend $backend, int $cardId): bool
    {
        $card = Card::query()->find($cardId);
        if ($card === null) {
            return false;
        }
        $rewritten = CardUid::withUid(self::cardData($card), CardUid::generate());
        if ($rewritten === null) {
            Log::warning('contacts.card_uid_backfill_skipped', ['card' => $cardId]);

            return false;
        }
        $backend->updateCard((int) $card->addressbookid, (string) $card->uri, $rewritten);

        return true;
    }

    private static function cardData(Card $card): string
    {
        return is_string($card->carddata) ? $card->carddata : (string) $card->carddata;
    }
}
