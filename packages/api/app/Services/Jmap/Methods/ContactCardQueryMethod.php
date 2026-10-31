<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Contacts\AddressBookRepository;
use App\Services\Contacts\ContactCardKindFilter;
use App\Services\Contacts\ContactCardRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

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
        $filter = $args['filter'] ?? [];
        if (! is_array($filter) || ($filter !== [] && array_is_list($filter))) {
            throw new JmapMethodException('invalidArguments', 'filter must be null or a FilterCondition object.');
        }
        $unsupported = array_diff(array_keys($filter), self::SUPPORTED_FILTER_CONDITIONS);
        if ($unsupported !== []) {
            throw new JmapMethodException(
                'unsupportedFilter',
                'Unsupported filter conditions: '.implode(', ', array_map(strval(...), $unsupported)).'.',
            );
        }

        $sort = $args['sort'] ?? [];
        if (! is_array($sort) || ! array_is_list($sort)) {
            throw new JmapMethodException('invalidArguments', 'sort must be null or an array of comparators.');
        }
        if ($sort !== []) {
            // The backing query only orders by card uri; claiming to honour
            // created/updated/name sorts would silently lie.
            throw new JmapMethodException('unsupportedSort', 'Sorting is not supported; results are ordered by id.');
        }

        $position = $args['position'] ?? 0;
        if (! is_int($position) || $position < 0) {
            throw new JmapMethodException('invalidArguments', 'position must be a non-negative integer.');
        }

        $limit = $args['limit'] ?? null;
        if ($limit !== null && (! is_int($limit) || $limit < 1)) {
            throw new JmapMethodException('invalidArguments', 'limit must be null or a positive integer.');
        }

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
        $total = 0;
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
            $total += count($bookIds);
        }

        $response = [
            'accountId' => $username,
            'queryState' => $queryState,
            'canCalculateChanges' => false,
            'position' => $position,
            'ids' => array_slice($ids, $position, $limit),
            'total' => $total,
        ];
        if ($limit !== null) {
            $response['limit'] = $limit;
        }

        return $response;
    }
}
