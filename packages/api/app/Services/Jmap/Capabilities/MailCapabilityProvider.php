<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Mail\ImapExtension;
use App\Services\Mail\MailCredentialService;
use App\Services\Mail\MailUserRuntime;

/**
 * urn:ietf:params:jmap:mail — omitted when this user has no mailbox account
 * or ext-imap is missing.
 *
 * Request is resolved lazily: JmapCapabilitySet may be a long-lived binding,
 * and injecting Request in the constructor would freeze the first principal.
 */
final class MailCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function __construct(
        private MailCredentialService $credentials,
    ) {}

    public function urn(): string
    {
        return JmapCapabilities::MAIL;
    }

    public function isEnabled(): bool
    {
        if (! ImapExtension::loaded()) {
            return false;
        }
        $principal = request()->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if (! is_array($principal) || ! isset($principal['username'])) {
            return false;
        }

        return MailUserRuntime::isReady($this->credentials->loadAccount((string) $principal['username']));
    }

    public function sessionCapability(): object|array
    {
        return (object) [];
    }

    public function accountCapability(): array
    {
        return JmapCapabilities::mailAccountCapability();
    }
}
