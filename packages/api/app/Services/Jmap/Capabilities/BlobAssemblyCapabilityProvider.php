<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;

/**
 * https://wegotworkspace.org/jmap/blob-assembly (#1500): stepwise assembly of one blob from parts on hosts with a short max_execution_time.
 */
final class BlobAssemblyCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::BLOB_ASSEMBLY;
    }

    public function isEnabled(): bool
    {
        return true;
    }

    public function sessionCapability(): object
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return JmapCapabilities::blobAssemblyAccountCapability();
    }
}
