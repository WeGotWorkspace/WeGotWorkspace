<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;

/**
 * urn:ietf:params:jmap:filenode (draft-ietf-jmap-filenode-14, #450) behind
 * the envelope, gated by the same files_enabled setting the drive reads.
 */
final class FilesCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::FILENODE;
    }

    public function isEnabled(): bool
    {
        $cfg = WgwSettings::normalized();

        return (bool) ($cfg[WgwSettings::FILES_ENABLED] ?? true);
    }

    /**
     * Session-level filenode capability is the empty object (draft-14 §2.1).
     */
    public function sessionCapability(): object|array
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return JmapCapabilities::filenodeAccountCapability();
    }
}
