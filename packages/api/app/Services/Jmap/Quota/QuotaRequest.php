<?php

declare(strict_types=1);

namespace App\Services\Jmap\Quota;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapRequestContext;

/**
 * The quotas visible to one request. RFC 9425 §4.1: the server MUST filter
 * out types the client did not request in `using` and MUST NOT return a
 * Quota with no recognized type — the Drive quota's only type is FileNode.
 */
final class QuotaRequest
{
    public function __construct(
        private readonly DriveQuotaService $drive,
        private readonly JmapRequestContext $context,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function quotas(string $username): array
    {
        if (! $this->context->uses(JmapCapabilities::FILENODE)) {
            return [];
        }

        return $this->drive->quotasFor($username);
    }

    /**
     * @param  list<array<string, mixed>>  $quotas
     */
    public function state(array $quotas): string
    {
        return QuotaStateCodec::encode(QuotaStateCodec::fingerprints($quotas));
    }
}
