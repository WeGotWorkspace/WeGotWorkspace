<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;

/**
 * https://wegotworkspace.org/jmap/filenode-share-flags (#2063): with it in `using`, FileNode/get
 * returns `shareFlags`. Methodless; gated with the filenode domain. Members only: a guest owns
 * no shares, so the guest gateway does not offer it.
 */
final class FileNodeShareFlagsCapabilityProvider implements JmapMethodlessCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::FILENODE_SHARE_FLAGS;
    }

    public function isEnabled(): bool
    {
        return (bool) (WgwSettings::normalized()[WgwSettings::FILES_ENABLED] ?? true);
    }

    public function sessionCapability(): object
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return [];
    }
}
