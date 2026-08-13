<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * ContactCard/queryChanges is part of the advertised contacts capability, so
 * unknownMethod would be a compliance lie; cannotCalculateChanges is the
 * RFC-sanctioned answer and matches the always-false canCalculateChanges on
 * query responses — same decision as CalendarEvent/queryChanges.
 */
final class ContactCardQueryChangesMethod implements JmapMethodInterface
{
    public function name(): string
    {
        return 'ContactCard/queryChanges';
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
        throw new JmapMethodException('cannotCalculateChanges', 'ContactCard/queryChanges is not supported.');
    }
}
