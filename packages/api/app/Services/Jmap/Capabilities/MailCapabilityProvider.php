<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;

/**
 * Vendor urn:wgw:jmap:mail: the Mailboxes of the user's connected IMAP
 * mailbox. That mailbox is connected for Calendar's invitation replies today,
 * so the domain follows the calendars feature gate.
 */
final class MailCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function __construct(private readonly CalendarsCapabilityProvider $calendars) {}

    public function urn(): string
    {
        return JmapCapabilities::MAIL;
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
        return JmapCapabilities::mailAccountCapability();
    }
}
