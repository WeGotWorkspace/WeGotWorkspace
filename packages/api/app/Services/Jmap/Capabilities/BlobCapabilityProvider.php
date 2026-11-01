<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;

/**
 * urn:ietf:params:jmap:blob (RFC 9404, #1500): Blob/upload and a minimal Blob/get. Not feature-gated: blobs are shared by every envelope domain.
 */
final class BlobCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::BLOB;
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
        return JmapCapabilities::blobAccountCapability();
    }
}
