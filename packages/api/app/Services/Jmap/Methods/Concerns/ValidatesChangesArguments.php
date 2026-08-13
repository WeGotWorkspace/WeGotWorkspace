<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods\Concerns;

use App\Services\Jmap\JmapMethodException;

/**
 * Shared /changes argument handling (RFC 8620 §5.2).
 */
trait ValidatesChangesArguments
{
    private function sinceState(array $args): string
    {
        $sinceState = $args['sinceState'] ?? null;
        if (! is_string($sinceState)) {
            throw new JmapMethodException('invalidArguments', 'sinceState is required.');
        }

        $maxChanges = $args['maxChanges'] ?? null;
        if ($maxChanges !== null && (! is_int($maxChanges) || $maxChanges < 1)) {
            // Accepted but never used for truncation (hasMoreChanges is
            // always false); still validated per RFC 8620 §5.2.
            throw new JmapMethodException('invalidArguments', 'maxChanges must be null or a positive integer.');
        }

        return $sinceState;
    }
}
