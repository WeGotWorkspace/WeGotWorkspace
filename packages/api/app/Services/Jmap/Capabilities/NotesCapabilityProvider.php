<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;

/**
 * Vendor urn:wgw:jmap:notes over the existing VJOURNAL repositories.
 */
final class NotesCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function urn(): string
    {
        return JmapCapabilities::NOTES;
    }

    public function isEnabled(): bool
    {
        $cfg = WgwSettings::normalized();

        return (bool) ($cfg[WgwSettings::NOTES_ENABLED] ?? true);
    }

    public function sessionCapability(): object|array
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return JmapCapabilities::notesAccountCapability();
    }
}
