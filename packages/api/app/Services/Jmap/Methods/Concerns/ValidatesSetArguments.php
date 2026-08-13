<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods\Concerns;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * Shared /set argument handling (RFC 8620 §5.3): genuine top-level
 * ifInState and create/update/destroy shape validation with the
 * maxObjectsInSet bound.
 */
trait ValidatesSetArguments
{
    /**
     * Rejects the whole method call with stateMismatch when args.ifInState
     * is present and differs from the current account-wide state — before
     * any mutation happens (spec §5).
     */
    private function guardIfInState(array $args, string $currentState): void
    {
        $ifInState = $args['ifInState'] ?? null;
        if ($ifInState === null) {
            return;
        }
        if (! is_string($ifInState)) {
            throw new JmapMethodException('invalidArguments', 'ifInState must be null or a string.');
        }
        if ($ifInState !== $currentState) {
            throw new JmapMethodException('stateMismatch', 'ifInState does not match the current state.');
        }
    }

    /**
     * @return array{0: array<string, mixed>, 1: array<string, mixed>, 2: list<mixed>}
     */
    private function setOperations(array $args): array
    {
        $create = $args['create'] ?? [];
        $update = $args['update'] ?? [];
        $destroy = $args['destroy'] ?? [];
        $create = is_array($create) ? $create : [];
        $update = is_array($update) ? $update : [];
        $destroy = is_array($destroy) && array_is_list($destroy) ? $destroy : [];

        if (count($create) + count($update) + count($destroy) > JmapCapabilities::MAX_OBJECTS_IN_SET) {
            throw new JmapMethodException('requestTooLarge', 'create/update/destroy exceeds maxObjectsInSet.');
        }

        return [$create, $update, $destroy];
    }
}
