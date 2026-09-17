<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;

/**
 * urn:ietf:params:jmap:submission — same gate as mail (per-user mailbox + ext-imap).
 */
final class SubmissionCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function __construct(private MailCapabilityProvider $mail) {}

    public function urn(): string
    {
        return JmapCapabilities::SUBMISSION;
    }

    public function isEnabled(): bool
    {
        return $this->mail->isEnabled();
    }

    public function sessionCapability(): object|array
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return JmapCapabilities::submissionAccountCapability();
    }
}
