<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods\Concerns;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * Shared /get argument handling (RFC 8620 §5.1): ids validation with the
 * maxObjectsInGet bound, and the properties projection.
 */
trait HandlesGetArguments
{
    /**
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
     * @param  list<array<string, mixed>>  $records
     * @return list<array<string, mixed>>
     */
    private function projectProperties(array $records, array $args): array
    {
        $properties = $args['properties'] ?? null;
        if ($properties === null) {
            return $records;
        }
        if (! is_array($properties) || ! array_is_list($properties)) {
            throw new JmapMethodException('invalidArguments', 'properties must be null or an array of property names.');
        }

        // The id property is always returned (RFC 8620 §5.1).
        $keep = ['id' => true];
        foreach ($properties as $property) {
            if (! is_string($property)) {
                throw new JmapMethodException('invalidArguments', 'properties must contain strings.');
            }
            $keep[$property] = true;
        }

        return array_map(
            static fn (array $record): array => array_intersect_key($record, $keep),
            $records,
        );
    }
}
