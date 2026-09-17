<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;

/**
 * Vendor urn:wgw:jmap:chat over the chat channel/message repositories
 * (Epic #701 chunk D). Chat has no feature gate today (the /chat/* REST
 * surface is always on), so the provider is unconditionally enabled; wiring
 * a WgwSettings gate later only touches isEnabled().
 */
final class ChatCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::CHAT;
    }

    public function isEnabled(): bool
    {
        return true;
    }

    public function sessionCapability(): object|array
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return JmapCapabilities::chatAccountCapability();
    }
}
