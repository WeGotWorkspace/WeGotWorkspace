<?php

declare(strict_types=1);

namespace App\Services\Jmap\Capabilities;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodDispatcher;

/**
 * The enabled JMAP capability set for the current request: which URNs the
 * batch endpoint accepts in `using`, and how the Session resource advertises
 * them. Derived — never hardcoded — from two sources:
 *
 *  1. the dispatcher's registered methods (a URN with no registered methods
 *     is never supported, so the two can't drift), and
 *  2. each domain provider's feature gate (a gated-off domain drops out of
 *     the session document and `using` in the same request).
 *
 * The session `state` is derived from the enabled URN set: RFC 8620 §2 only
 * requires it to change whenever the session document changes, which for a
 * static-per-configuration document is exactly a capability-set change.
 */
final class JmapCapabilitySet
{
    /**
     * Domain capability providers; new envelope domains append their
     * provider class here (and their methods to JmapMethodDispatcher::METHODS).
     *
     * @var list<class-string<JmapCapabilityProviderInterface>>
     */
    public const PROVIDERS = [
        CalendarsCapabilityProvider::class,
        ContactsCapabilityProvider::class,
    ];

    /** @var list<JmapCapabilityProviderInterface> */
    private array $providers;

    /**
     * Resolved from self::PROVIDERS by the container binding in
     * WgwServiceProvider — autowiring cannot construct a provider list.
     *
     * @param  list<JmapCapabilityProviderInterface>  $providers
     */
    public function __construct(
        private readonly JmapMethodDispatcher $dispatcher,
        array $providers,
    ) {
        $this->providers = $providers;
    }

    /**
     * URNs accepted in `using` (RFC 8620 §3.3): core plus every enabled
     * domain that actually has registered methods.
     *
     * @return list<string>
     */
    public function supportedUrns(): array
    {
        $urns = [JmapCapabilities::CORE];
        foreach ($this->enabledProviders() as $provider) {
            $urns[] = $provider->urn();
        }

        return $urns;
    }

    /**
     * Session-level `capabilities` map (RFC 8620 §2).
     *
     * @return array<string, mixed>
     */
    public function sessionCapabilities(): array
    {
        $capabilities = [JmapCapabilities::CORE => JmapCapabilities::coreCapability()];
        foreach ($this->enabledProviders() as $provider) {
            $capabilities[$provider->urn()] = $provider->sessionCapability();
        }

        return $capabilities;
    }

    /**
     * Account-level `accountCapabilities` map for the (single) account.
     *
     * @return array<string, array<string, mixed>>
     */
    public function accountCapabilities(): array
    {
        $capabilities = [];
        foreach ($this->enabledProviders() as $provider) {
            $capabilities[$provider->urn()] = $provider->accountCapability();
        }

        return $capabilities;
    }

    /**
     * `primaryAccounts` map: every advertised capability URN (core included)
     * points at the principal's single account.
     *
     * @return array<string, string>
     */
    public function primaryAccounts(string $accountId): array
    {
        $accounts = [];
        foreach ($this->supportedUrns() as $urn) {
            $accounts[$urn] = $accountId;
        }

        return $accounts;
    }

    /**
     * Top-level session state: the SESSION_STATE document version plus a
     * digest of the enabled URN set, so toggling a domain feature gate is a
     * session change the client can observe (onSessionStateChange → refetch).
     */
    public function sessionState(): string
    {
        $urns = $this->supportedUrns();
        sort($urns);

        return JmapCapabilities::SESSION_STATE.';'.substr(sha1(implode('|', $urns)), 0, 8);
    }

    /**
     * @return list<JmapCapabilityProviderInterface>
     */
    private function enabledProviders(): array
    {
        $registered = $this->dispatcher->capabilityUrns();

        return array_values(array_filter(
            $this->providers,
            static fn (JmapCapabilityProviderInterface $provider): bool => $provider->isEnabled()
                && in_array($provider->urn(), $registered, true),
        ));
    }
}
