<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;

/**
 * urn:ietf:params:jmap:contacts (RFC 9610) behind the envelope, gated by the
 * same contacts_enabled setting the REST layer's wgw.contacts middleware reads.
 */
final class ContactsCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::CONTACTS;
    }

    public function isEnabled(): bool
    {
        $cfg = WgwSettings::normalized();

        return (bool) ($cfg[WgwSettings::CONTACTS_ENABLED] ?? true);
    }

    /**
     * Session-level contacts capability is the empty object; the two-property
     * object lives in accountCapabilities (RFC 9610 §1.3).
     */
    public function sessionCapability(): object|array
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return JmapCapabilities::contactsAccountCapability();
    }
}
