<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;

/**
 * https://wegotworkspace.org/jmap/filenode-tree (#2063): enables the FileNode/query keyset
 * arguments `idAfter` and `asOfState` and the FileNode property `path`. Methodless; gated
 * with the filenode domain. Guests do not get it: their query is one folder at a time.
 */
final class FileNodeTreeCapabilityProvider implements JmapMethodlessCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::FILENODE_TREE;
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
