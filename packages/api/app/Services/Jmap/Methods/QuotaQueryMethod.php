<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Quota\QuotaRequest;

/**
 * Quota/query (RFC 9425 §4.4): filter by name (contains), scope,
 * resourceType, and type; sortable by name and used (the two sorts the RFC
 * requires). canCalculateChanges is false (Quota/queryChanges answers
 * cannotCalculateChanges).
 */
final class QuotaQueryMethod implements JmapMethodInterface
{
    private const FILTER_CONDITIONS = ['name', 'scope', 'resourceType', 'type'];

    private const SORT_PROPERTIES = ['name', 'used'];

    public function __construct(private readonly QuotaRequest $quotas) {}

    public function name(): string
    {
        return 'Quota/query';
    }

    public function capability(): string
    {
        return JmapCapabilities::QUOTA;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $filter = $this->filter($args);
        $sort = $this->sort($args);

        $position = $args['position'] ?? 0;
        if (! is_int($position)) {
            throw new JmapMethodException('invalidArguments', 'position must be an integer.');
        }
        $anchor = $args['anchor'] ?? null;
        if ($anchor !== null && ! is_string($anchor)) {
            throw new JmapMethodException('invalidArguments', 'anchor must be null or an id.');
        }
        $anchorOffset = $args['anchorOffset'] ?? 0;
        if (! is_int($anchorOffset)) {
            throw new JmapMethodException('invalidArguments', 'anchorOffset must be an integer.');
        }
        $limit = $args['limit'] ?? null;
        if ($limit !== null && (! is_int($limit) || $limit < 0)) {
            throw new JmapMethodException('invalidArguments', 'limit must be null or a non-negative integer.');
        }
        $calculateTotal = ($args['calculateTotal'] ?? false) === true;

        $all = $this->quotas->quotas($username);
        $matching = array_values(array_filter($all, fn (array $quota): bool => $this->matches($quota, $filter)));
        $this->sortQuotas($matching, $sort);
        $ids = array_map(static fn (array $quota): string => (string) $quota['id'], $matching);
        $total = count($ids);

        if ($anchor !== null) {
            $index = array_search($anchor, $ids, true);
            if ($index === false) {
                throw new JmapMethodException('anchorNotFound', 'The anchor is not in the results.');
            }
            $start = max(0, $index + $anchorOffset);
        } else {
            // RFC 8620 §5.5: a negative position counts from the end.
            $start = $position < 0 ? max(0, $total + $position) : min($position, $total);
        }

        $response = [
            'accountId' => $username,
            'queryState' => $this->quotas->state($all),
            'canCalculateChanges' => false,
            'position' => $start,
            'ids' => array_slice($ids, $start, $limit),
        ];
        if ($calculateTotal) {
            $response['total'] = $total;
        }
        if ($limit !== null) {
            $response['limit'] = $limit;
        }

        return $response;
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, string>
     */
    private function filter(array $args): array
    {
        $filter = $args['filter'] ?? [];
        if (! is_array($filter) || ($filter !== [] && array_is_list($filter))) {
            throw new JmapMethodException('invalidArguments', 'filter must be null or a FilterCondition object.');
        }
        $unsupported = array_diff(array_keys($filter), self::FILTER_CONDITIONS);
        if ($unsupported !== []) {
            throw new JmapMethodException('unsupportedFilter', 'Unsupported filter conditions: '.implode(', ', array_map(strval(...), $unsupported)).'.');
        }
        $out = [];
        foreach ($filter as $condition => $value) {
            if (! is_string($value)) {
                throw new JmapMethodException('invalidArguments', sprintf('Filter condition "%s" must be a string.', $condition));
            }
            $out[(string) $condition] = $value;
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $args
     * @return list<array{property: string, isAscending: bool}>
     */
    private function sort(array $args): array
    {
        $sort = $args['sort'] ?? [];
        if (! is_array($sort) || ! array_is_list($sort)) {
            throw new JmapMethodException('invalidArguments', 'sort must be null or an array of comparators.');
        }
        $out = [];
        foreach ($sort as $comparator) {
            $property = is_array($comparator) ? ($comparator['property'] ?? null) : null;
            if (! is_string($property) || ! in_array($property, self::SORT_PROPERTIES, true)) {
                throw new JmapMethodException('unsupportedSort', 'Supported sort properties: '.implode(', ', self::SORT_PROPERTIES).'.');
            }
            $out[] = ['property' => $property, 'isAscending' => ($comparator['isAscending'] ?? true) !== false];
        }

        return $out === [] ? [['property' => 'name', 'isAscending' => true]] : $out;
    }

    /**
     * @param  array<string, mixed>  $quota
     * @param  array<string, string>  $filter
     */
    private function matches(array $quota, array $filter): bool
    {
        if (isset($filter['name']) && mb_stripos((string) $quota['name'], $filter['name']) === false) {
            return false;
        }
        if (isset($filter['scope']) && $quota['scope'] !== $filter['scope']) {
            return false;
        }
        if (isset($filter['resourceType']) && $quota['resourceType'] !== $filter['resourceType']) {
            return false;
        }
        if (isset($filter['type']) && ! in_array($filter['type'], (array) $quota['types'], true)) {
            return false;
        }

        return true;
    }

    /**
     * @param  list<array<string, mixed>>  $quotas
     * @param  list<array{property: string, isAscending: bool}>  $sort
     */
    private function sortQuotas(array &$quotas, array $sort): void
    {
        usort($quotas, static function (array $a, array $b) use ($sort): int {
            foreach ($sort as $comparator) {
                $result = $comparator['property'] === 'used'
                    ? ((int) $a['used']) <=> ((int) $b['used'])
                    : strcasecmp((string) $a['name'], (string) $b['name']);
                if ($result !== 0) {
                    return $comparator['isAscending'] ? $result : -$result;
                }
            }

            return strcmp((string) $a['id'], (string) $b['id']);
        });
    }
}
