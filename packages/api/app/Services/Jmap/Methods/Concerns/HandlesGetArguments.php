<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods\Concerns;

use App\Services\Jmap\GetProjection;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * Shared /get argument handling (RFC 8620 §5.1): ids validation with the
 * maxObjectsInGet bound, and the properties projection.
 */
trait HandlesGetArguments
{
    /**
     * @param  array<string, mixed>  $args
     * @return list<string>|null null means "all records"
     */
    private function requestedIds(array $args): ?array
    {
        $ids = $args['ids'] ?? null;
        if ($ids === null) {
            return null;
        }
        if (! is_array($ids) || ! array_is_list($ids)) {
            throw new JmapMethodException('invalidArguments', 'ids must be null or an array of ids.');
        }
        if (count($ids) > JmapCapabilities::MAX_OBJECTS_IN_GET) {
            throw new JmapMethodException('requestTooLarge', 'ids exceeds maxObjectsInGet.');
        }
        foreach ($ids as $id) {
            if (! is_string($id) || $id === '') {
                throw new JmapMethodException('invalidArguments', 'ids must contain non-empty strings.');
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * RFC 8620 §5.1: a get-all (ids: null) whose result would exceed
     * maxObjectsInGet must be rejected with requestTooLarge, same as an
     * over-long explicit ids list.
     *
     * @param  list<mixed>  $records
     */
    private function guardGetAllBound(array $records): void
    {
        if (count($records) > JmapCapabilities::MAX_OBJECTS_IN_GET) {
            throw new JmapMethodException('requestTooLarge', 'The number of records exceeds maxObjectsInGet; request explicit ids.');
        }
    }

    /**
     * The parsed `properties` argument. Build it before loading anything and
     * apply it to each record as it is mapped, so a page never holds more than
     * one full record (see {@see GetProjection}).
     *
     * @param  array<string, mixed>  $args
     */
    private function getProjection(array $args): GetProjection
    {
        return GetProjection::fromArgs($args);
    }

    /**
     * Whole-list projection for methods that still map everything first.
     *
     * @param  list<array<string, mixed>>  $records
     * @param  array<string, mixed>  $args
     * @return list<array<string, mixed>>
     */
    private function projectProperties(array $records, array $args): array
    {
        $projection = GetProjection::fromArgs($args);

        return array_map($projection->apply(...), $records);
    }
}
