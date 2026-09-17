<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * Note/queryChanges is advertised with the vendor notes capability;
 * cannotCalculateChanges is the RFC-sanctioned answer.
 */
final class NoteQueryChangesMethod implements JmapMethodInterface
{
    public function name(): string
    {
        return 'Note/queryChanges';
    }

    public function capability(): string
    {
        return JmapCapabilities::NOTES;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        throw new JmapMethodException('cannotCalculateChanges', 'Note/queryChanges is not supported.');
    }
}
