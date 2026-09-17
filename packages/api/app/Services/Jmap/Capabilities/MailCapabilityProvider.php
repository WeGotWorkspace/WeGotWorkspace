<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Mail\ImapExtension;
use App\Services\Mail\MailCredentialService;
use App\Services\Mail\MailUserRuntime;
use App\Support\WgwSettings;
use Illuminate\Http\Request;

/**
 * urn:ietf:params:jmap:mail — omitted when the instance kill-switch is off,
 * this user has no mailbox account, or ext-imap is missing.
 */
final class MailCapabilityProvider implements JmapCapabilityProviderInterface
{
    public function __construct(
        private MailCredentialService $credentials,
        private Request $request,
    ) {}

    public function urn(): string
    {
        return JmapCapabilities::MAIL;
    }

    public function isEnabled(): bool
    {
        $cfg = WgwSettings::normalized();
        if (! MailUserRuntime::isInstanceEnabled($cfg)) {
            return false;
        }
        if (! ImapExtension::loaded()) {
            return false;
        }
        $principal = $this->request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
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
