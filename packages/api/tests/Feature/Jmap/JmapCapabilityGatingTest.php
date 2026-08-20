<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Domain feature gates on the JMAP envelope (chunk P of the multi-domain
 * roadmap, issue #436): the /jmap* routes live outside every domain
 * feature-gate middleware, and domain availability is expressed through the
 * advertised capabilities plus the `using` guard instead. A gated-off domain
 * is absent from the Session resource, rejected in `using` with a
 * request-level unknownCapability, and its methods are unknownMethod — but
 * the envelope itself stays up.
 */
final class JmapCapabilityGatingTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_disabled_domain_is_absent_from_the_session(): void
    {
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, false);

        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();

        $this->assertArrayHasKey(JmapCapabilities::CORE, $session['capabilities']);
        $this->assertArrayNotHasKey(JmapCapabilities::CALENDARS, $session['capabilities']);
        $this->assertArrayNotHasKey(JmapCapabilities::CALENDARS, $session['accounts']['bob']['accountCapabilities']);
        $this->assertSame('bob', $session['primaryAccounts'][JmapCapabilities::CORE]);
        $this->assertArrayNotHasKey(JmapCapabilities::CALENDARS, $session['primaryAccounts']);
    }

    public function test_disabled_domain_capability_in_using_is_unknown_capability(): void
    {
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, false);

        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [['Core/echo', ['hello' => 'world'], 'c0']],
        ]);

        // Request-level problem details (RFC 8620 §3.6.1), not a 403 from a
        // feature-gate middleware and not a method-level error.
        $response->assertStatus(400);
        $response->assertJsonPath('type', 'urn:ietf:params:jmap:error:unknownCapability');
    }

    public function test_disabled_domain_methods_are_unknown_with_core_only_using(): void
    {
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, false);

        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE],
            'methodCalls' => [
                ['Core/echo', ['hello' => 'world'], 'c0'],
                ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
            ],
        ])->assertOk();

        // Core keeps working; the gated domain's method is unknown (§3.2).
        $response->assertJsonPath('methodResponses.0.0', 'Core/echo');
        $response->assertJsonPath('methodResponses.1.0', 'error');
        $response->assertJsonPath('methodResponses.1.1.type', 'unknownMethod');
    }

    public function test_envelope_stays_up_while_the_rest_feature_gate_returns_403(): void
    {
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, false);
        $token = $this->userBearerToken();

        // Dual-protocol REST is gone; the envelope stays up when the domain
        // feature gate is off (capabilities + `using`, not HTTP 403).
        $this->withBearer($token)->getJson('/api/v1/calendars/calendars')->assertNotFound();
        $this->withBearer($token)->getJson('/api/v1/jmap/session')->assertOk();
    }

    public function test_session_state_changes_when_a_domain_gate_toggles(): void
    {
        $token = $this->userBearerToken();

        $enabledState = $this->withBearer($token)
            ->getJson('/api/v1/jmap/session')->assertOk()->json('state');

        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, false);
        $disabledState = $this->withBearer($token)
            ->getJson('/api/v1/jmap/session')->assertOk()->json('state');

        // The session document changed (capabilities differ), so the state
        // must change with it (RFC 8620 §2) — the derived digest guarantees it.
        $this->assertNotSame($enabledState, $disabledState);
        $this->assertStringStartsWith(JmapCapabilities::SESSION_STATE.';', $enabledState);
        $this->assertStringStartsWith(JmapCapabilities::SESSION_STATE.';', $disabledState);
    }

    public function test_enabled_domain_still_dispatches_normally(): void
    {
        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0']],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'Calendar/get');
        $response->assertJsonPath('methodResponses.0.1.accountId', 'bob');
    }
}
