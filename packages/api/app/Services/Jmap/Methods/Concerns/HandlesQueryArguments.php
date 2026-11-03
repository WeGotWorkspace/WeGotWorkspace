<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods\Concerns;

use App\Services\Jmap\JmapMethodException;

/**
 * Shared /query argument handling (RFC 8620 §5.5) for id listings that keep
 * one fixed order: filter validation, sort rejection, and the
 * position/limit window with `total`.
 */
trait HandlesQueryArguments
{
    /**
     * @param  array<string, mixed>  $args
     * @param  list<string>  $supported
     * @return array<string, mixed>
     */
    private function queryFilter(array $args, array $supported): array
    {
        $filter = $args['filter'] ?? [];
        if (! is_array($filter) || ($filter !== [] && array_is_list($filter))) {
            throw new JmapMethodException('invalidArguments', 'filter must be null or a FilterCondition object.');
        }
        $unsupported = array_diff(array_keys($filter), $supported);
        if ($unsupported !== []) {
            throw new JmapMethodException(
                'unsupportedFilter',
                'Unsupported filter conditions: '.implode(', ', array_map(strval(...), $unsupported)).'.',
            );
        }

        return $filter;
    }

    /**
     * Any comparator is refused: the listing has one fixed order, and
     * claiming another sort would silently lie.
     *
     * @param  array<string, mixed>  $args
     */
    private function rejectQuerySort(array $args): void
    {
        $sort = $args['sort'] ?? [];
        if (! is_array($sort) || ! array_is_list($sort)) {
            throw new JmapMethodException('invalidArguments', 'sort must be null or an array of comparators.');
        }
        if ($sort !== []) {
            throw new JmapMethodException('unsupportedSort', 'Sorting is not supported; results are ordered by id.');
        }
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array{0: int, 1: int|null} position and limit
     */
    private function queryWindowArguments(array $args): array
    {
        $position = $args['position'] ?? 0;
        if (! is_int($position) || $position < 0) {
            throw new JmapMethodException('invalidArguments', 'position must be a non-negative integer.');
        }
        $limit = $args['limit'] ?? null;
        if ($limit !== null && (! is_int($limit) || $limit < 1)) {
            throw new JmapMethodException('invalidArguments', 'limit must be null or a positive integer.');
        }

        return [$position, $limit];
    }

    /**
     * @param  list<string>  $ids  every matching id, in result order
     * @return array<string, mixed>
     */
    private function queryResponse(string $username, string $queryState, array $ids, int $position, ?int $limit): array
    {
        $response = [
            'accountId' => $username,
            'queryState' => $queryState,
            'canCalculateChanges' => false,
            'position' => $position,
            'ids' => array_slice($ids, $position, $limit),
            'total' => count($ids),
        ];
        if ($limit !== null) {
            $response['limit'] = $limit;
        }

        return $response;
    }
}
