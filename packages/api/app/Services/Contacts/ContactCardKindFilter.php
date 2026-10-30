<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Models\Card;
use App\Services\Contacts\Conversion\VCardJsContactConverter;
use Illuminate\Database\Eloquent\Builder;

/**
 * The RFC 9610 `kind` filter condition for ContactCard/query.
 *
 * A card's kind is what VCardJsContactConverter reads: a KIND or
 * X-ADDRESSBOOKSERVER-KIND line, member lines (a group), or X-ABSHOWAS
 * (an org). A vCard with none of those reads as "individual", so SQL picks
 * only the cards that mention one (the same LIKE match as
 * GroupMemberUriBackfill) and only those are parsed. The Contacts list asks
 * for the group ids in its first request to count contacts before they load.
 */
final class ContactCardKindFilter
{
    /** RFC 9553 §2.1.4 card kinds. */
    public const KINDS = ['individual', 'group', 'org', 'location', 'device', 'application'];

    private const DEFAULT_KIND = 'individual';

    private const MARKERS = ['KIND', 'MEMBER', 'X-ABSHOWAS', 'kind', 'member', 'x-abshowas'];

    public function __construct(
        private readonly VCardJsContactConverter $converter,
    ) {}

    /**
     * @param  list<string>  $ids  ContactCard ids from one book, in query order
     * @return list<string> the ids whose kind is $kind, in the same order
     */
    public function keep(int $addressBookId, array $ids, string $kind): array
    {
        $kinds = $this->kindsOfMarkedCards($addressBookId);

        return array_values(array_filter(
            $ids,
            static fn (string $id): bool => ($kinds[$id] ?? self::DEFAULT_KIND) === $kind,
        ));
    }

    /**
     * @return array<string, string> card id => kind, for readable cards that name a kind
     */
    private function kindsOfMarkedCards(int $addressBookId): array
    {
        $cards = Card::query()
            ->where('addressbookid', $addressBookId)
            ->where(static function (Builder $query): void {
                foreach (self::MARKERS as $marker) {
                    $query->orWhere('carddata', 'like', '%'.$marker.'%');
                }
            })
            ->get(['uri', 'carddata']);

        $kinds = [];
        foreach ($cards as $card) {
            $raw = is_string($card->carddata) ? $card->carddata : (string) $card->carddata;
            try {
                $kind = $this->converter->cardFromVCard($raw, 'debug')['kind'] ?? null;
            } catch (\Throwable) {
                // CardDAV can store a blob the guard rejects (too large, too
                // complex, not a vCard). Skip it like an unmarked card instead
                // of failing the query for the whole book; ContactCard/get
                // reports it in notFound.
                continue;
            }
            if (is_string($kind) && $kind !== '') {
                $kinds[ContactCardMapper::cardIdFromUri((string) $card->uri)] = $kind;
            }
        }

        return $kinds;
    }
}
