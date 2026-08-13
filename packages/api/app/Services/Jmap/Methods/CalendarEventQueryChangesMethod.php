<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * CalendarEvent/queryChanges is part of the advertised calendars capability,
 * so unknownMethod would be a compliance lie; cannotCalculateChanges is the
 * RFC-sanctioned answer and matches the always-false canCalculateChanges on
 * query responses (spec dispatch table). The shipped client never calls it.
 */
final class CalendarEventQueryChangesMethod implements JmapMethodInterface
{
    public function name(): string
    {
        return 'CalendarEvent/queryChanges';
    }

    public function capability(): string
    {
        return JmapCapabilities::CALENDARS;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        throw new JmapMethodException('cannotCalculateChanges', 'CalendarEvent/queryChanges is not supported.');
    }
}
