<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Contacts\AddressBookRepository;
use App\Services\Contacts\ContactCardKindFilter;
use App\Services\Contacts\ContactCardRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\HandlesQueryArguments;

/**
 * ContactCard/query over the existing ContactCardRepository::query().
 *
 * The repository requires filter.inAddressBook and supports the uid
 * condition; kind is applied on top by ContactCardKindFilter. The envelope
 * fans a book-less query out over every owned book
 * (RFC 9610 filter conditions are optional). Filter conditions and sort
 * comparators the backing query cannot honour are rejected with
 * unsupportedFilter / unsupportedSort (RFC 8620 §5.5) instead of silently
 * returning wrongly-ordered or unfiltered results. Position/limit windowing
 * happens here, after the per-book merge.
 */
final class ContactCardQueryMethod implements JmapMethodInterface
{
    use HandlesQueryArguments;

    private const SUPPORTED_FILTER_CONDITIONS = ['inAddressBook', 'uid', 'kind'];

    public function __construct(
        private readonly AddressBookRepository $books,
        private readonly ContactCardRepository $cards,
        private readonly ContactCardKindFilter $kinds,
    ) {}

    public function name(): string
    {
        return 'ContactCard/query';
    }

    public function capability(): string
    {
        return JmapCapabilities::CONTACTS;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $filter = $this->queryFilter($args, self::SUPPORTED_FILTER_CONDITIONS);
        // The backing query only orders by card uri.
        $this->rejectQuerySort($args);
        [$position, $limit] = $this->queryWindowArguments($args);

        $kind = $filter['kind'] ?? null;
        if ($kind !== null && (! is_string($kind) || $kind === '')) {
            throw new JmapMethodException('invalidArguments', 'filter.kind must be a non-empty string.');
        }
        if ($kind !== null && ! in_array($kind, ContactCardKindFilter::KINDS, true)) {
            throw new JmapMethodException('unsupportedFilter', 'filter.kind must be an RFC 9553 card kind.');
        }

        $tokens = $this->books->syncTokens($username);
        $queryState = JmapAccountStateCodec::compose($tokens);

        $bookUris = [];
        $inAddressBook = $filter['inAddressBook'] ?? null;
        if ($inAddressBook !== null) {
            if (! is_string($inAddressBook) || $inAddressBook === '') {
                throw new JmapMethodException('invalidArguments', 'filter.inAddressBook must be a non-empty id.');
            }
            $bookUris = [$inAddressBook];
        } else {
            $bookUris = array_keys($tokens);
        }

        $ids = [];
        foreach ($bookUris as $bookUri) {
            $bookFilter = ['inAddressBook' => $bookUri];
            if (isset($filter['uid'])) {
                $bookFilter['uid'] = $filter['uid'];
            }
            $bookIds = $this->cards->query($username, $bookFilter, null)['ids'];
            if ($kind !== null) {
                $bookId = (int) $this->books->requireAccessibleBook($username, $bookUri)->id;
                $bookIds = $this->kinds->keep($bookId, $bookIds, $kind);
            }
            array_push($ids, ...$bookIds);
        }

        return $this->queryResponse($username, $queryState, $ids, $position, $limit);
    }
}
