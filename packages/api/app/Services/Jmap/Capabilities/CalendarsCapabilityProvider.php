<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;

/**
 * urn:ietf:params:jmap:calendars behind the envelope, gated by the same
 * calendar_enabled setting the REST layer's wgw.calendars middleware reads.
 */
final class CalendarsCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::CALENDARS;
    }

    public function isEnabled(): bool
    {
        $cfg = WgwSettings::normalized();

        return (bool) ($cfg[WgwSettings::CALENDAR_ENABLED] ?? true);
    }

    /**
     * Session-level calendars capability is the empty object; the
     * six-property object lives in accountCapabilities
     * (draft-ietf-jmap-calendars-27 §1.5.1).
     */
    public function sessionCapability(): object|array
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return JmapCapabilities::calendarsAccountCapability();
    }
}
