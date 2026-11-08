<?php

declare(strict_types=1);

namespace App\Dav\Server;

/**
 * Account principals that CalDAV local delivery may reach in this request.
 *
 * `principals/{user}` resolves colleagues only ({@see AppCalDAVPrincipalCollection}),
 * but Sabre's local delivery reaches the recipient's inbox through that node.
 * When {@see CalendarScheduleDeliveryGuardPlugin} lets a message through to
 * someone the sender cannot find, such as an attendee's reply to an admin's
 * invite, it opens that one principal for the rest of the request.
 * Bound scoped and cleared when a request starts: nothing outlives the request.
 */
final class CalDavDeliveryRecipients
{
    /** @var array<string, true> */
    private array $principalUris = [];

    public function allow(string $principalUri): void
    {
        $this->principalUris[$principalUri] = true;
    }

    public function allows(string $principalUri): bool
    {
        return isset($this->principalUris[$principalUri]);
    }

    public function forget(): void
    {
        $this->principalUris = [];
    }
}
