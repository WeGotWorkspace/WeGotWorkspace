<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

/**
 * One JMAP domain capability behind the envelope (calendars, contacts, …).
 *
 * Providers own the three per-domain concerns the session and batch endpoint
 * used to hardcode for calendars: the capability URN, the feature gate, and
 * the session-level / account-level capability objects. A domain whose gate
 * is off drops out of the Session resource and is rejected in `using` with
 * a request-level unknownCapability (never a feature-gate middleware 403).
 */
interface JmapCapabilityProviderInterface
{
    public function urn(): string;

    /**
     * Feature gate — false removes the domain from the session document and
     * from the supported `using` set for this request.
     */
    public function isEnabled(): bool;

    /**
     * Session-level capability value (RFC 8620 §2 `capabilities`). For the
     * calendars draft this is the empty object; other domains may advertise
     * limits here.
     */
    public function sessionCapability(): object|array;

    /**
     * Account-level capability object (`accounts.*.accountCapabilities`).
     *
     * @return array<string, mixed>
     */
    public function accountCapability(): array;
}
