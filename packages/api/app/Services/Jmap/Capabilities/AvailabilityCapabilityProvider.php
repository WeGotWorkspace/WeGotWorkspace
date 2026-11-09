<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;

/**
 * Vendor urn:wgw:jmap:availability (#1909): Team availability computed on
 * request from calendars, so it follows the calendars feature gate.
 */
final class AvailabilityCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function __construct(private readonly CalendarsCapabilityProvider $calendars) {}

    public function urn(): string
    {
        return JmapCapabilities::AVAILABILITY;
    }

    public function isEnabled(): bool
    {
        return $this->calendars->isEnabled();
    }

    public function sessionCapability(): object
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return JmapCapabilities::availabilityAccountCapability();
    }
}
