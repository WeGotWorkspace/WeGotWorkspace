<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;

/**
 * urn:ietf:params:jmap:quota (RFC 9425, #1500): one Drive quota per writable root, gated by files_enabled. Session and account values are the empty object.
 */
final class QuotaCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::QUOTA;
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
