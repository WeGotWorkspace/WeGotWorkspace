<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * Quota/queryChanges (RFC 9425 §4.5): always cannotCalculateChanges — an
 * account has a handful of quotas; the client re-runs Quota/query.
 */
final class QuotaQueryChangesMethod implements JmapMethodInterface
{
    public function name(): string
    {
        return 'Quota/queryChanges';
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
        throw new JmapMethodException('cannotCalculateChanges', 'Quota/queryChanges is not supported; re-run Quota/query.');
    }
}
