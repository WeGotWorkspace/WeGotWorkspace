<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;

/**
 * https://wegotworkspace.org/jmap/filenode-version-check (#1500): enables the expectedBlobId update property on FileNode/set. Methodless; gated with the filenode domain.
 */
final class FileNodeVersionCheckCapabilityProvider implements JmapMethodlessCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::FILENODE_VERSION_CHECK;
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
