<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Transport plumbing for POST /api/v1/jmap (RFC 8620 §3): envelope status
 * codes, ResultReference resolution, and error vocabulary — no calendar
 * semantics (Core/echo is the stub method).
 */
final class JmapDispatcherTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     * @param  list<string>|null  $using
     */
    private function jmap(array $methodCalls, ?array $using = null): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => $using ?? [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_requires_authentication(): void
    {
        $this->postJson('/api/v1/jmap', ['using' => [JmapCapabilities::CORE], 'methodCalls' => []])
            ->assertUnauthorized();
    }

    public function test_core_echo_round_trips_and_echoes_session_state(): void
    {
        $response = $this->jmap([
            ['Core/echo', ['hello' => 'world', 'nested' => ['a' => 1]], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'Core/echo');
        $response->assertJsonPath('methodResponses.0.1.hello', 'world');
        $response->assertJsonPath('methodResponses.0.1.nested.a', 1);
        $response->assertJsonPath('methodResponses.0.2', 'c0');
        $response->assertJsonPath('sessionState', JmapCapabilities::SESSION_STATE);
    }

    public function test_result_reference_resolves_json_pointer_against_prior_call(): void
    {
        $response = $this->jmap([
            ['Core/echo', ['ids' => ['a', 'b', 'c']], 'c0'],
            ['Core/echo', ['#ids' => ['resultOf' => 'c0', 'name' => 'Core/echo', 'path' => '/ids']], 'c1'],
        ])->assertOk();

        // The exact "#ids" wiring the shipped client uses in getCalendarEventsInRange().
        $response->assertJsonPath('methodResponses.1.0', 'Core/echo');
        $response->assertJsonPath('methodResponses.1.1.ids', ['a', 'b', 'c']);
        $this->assertArrayNotHasKey('#ids', $response->json('methodResponses.1.1'));
    }

    public function test_result_reference_star_pointer_maps_and_flattens_arrays(): void
    {
        $response = $this->jmap([
            ['Core/echo', ['list' => [['ids' => ['a', 'b']], ['ids' => ['c']]]], 'c0'],
            ['Core/echo', ['#ids' => ['resultOf' => 'c0', 'name' => 'Core/echo', 'path' => '/list/*/ids']], 'c1'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.1.1.ids', ['a', 'b', 'c']);
    }

    public function test_reference_and_plain_argument_conflict_is_invalid_arguments(): void
    {
        $response = $this->jmap([
            ['Core/echo', ['ids' => ['a']], 'c0'],
            ['Core/echo', [
                'ids' => ['x'],
                '#ids' => ['resultOf' => 'c0', 'name' => 'Core/echo', 'path' => '/ids'],
            ], 'c1'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.1.0', 'error');
        $response->assertJsonPath('methodResponses.1.1.type', 'invalidArguments');
    }

    public function test_unresolvable_reference_is_invalid_result_reference(): void
    {
        // No matching prior call id.
        $this->jmap([
            ['Core/echo', ['#ids' => ['resultOf' => 'nope', 'name' => 'Core/echo', 'path' => '/ids']], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'invalidResultReference');

        // Path does not resolve.
        $this->jmap([
            ['Core/echo', ['ids' => ['a']], 'c0'],
            ['Core/echo', ['#ids' => ['resultOf' => 'c0', 'name' => 'Core/echo', 'path' => '/missing']], 'c1'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.1.0', 'error')
            ->assertJsonPath('methodResponses.1.1.type', 'invalidResultReference');

        // Malformed ResultReference object.
        $this->jmap([
            ['Core/echo', ['#ids' => ['resultOf' => 'c0']], 'c1'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.1.type', 'invalidResultReference');
    }

    public function test_reference_to_an_errored_call_is_invalid_result_reference(): void
    {
        // The referenced call responds ["error", ...] whose name never matches
        // the reference's name — spec edge case: must not silently resolve.
        $response = $this->jmap([
            ['Bogus/method', [], 'c0'],
            ['Core/echo', ['#ids' => ['resultOf' => 'c0', 'name' => 'Bogus/method', 'path' => '/ids']], 'c1'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.1.type', 'unknownMethod');
        $response->assertJsonPath('methodResponses.1.0', 'error');
        $response->assertJsonPath('methodResponses.1.1.type', 'invalidResultReference');
    }

    public function test_unknown_method_is_a_method_level_error_inside_a_200(): void
    {
        $this->jmap([['Calendar/frobnicate', [], 'c0']])
            ->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'unknownMethod')
            ->assertJsonPath('methodResponses.0.2', 'c0');
    }

    public function test_method_without_its_capability_in_using_is_unknown_method(): void
    {
        $this->jmap([['Core/echo', [], 'c0']], [JmapCapabilities::CALENDARS])
            ->assertOk()
            ->assertJsonPath('methodResponses.0.1.type', 'unknownMethod');
    }

    public function test_malformed_json_body_is_a_request_level_not_json_error(): void
    {
        $this->withBearer($this->userBearerToken())
            ->call('POST', '/api/v1/jmap', server: [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
            ], content: '{not json')
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:notJSON');
    }

    public function test_missing_or_malformed_request_fields_are_not_request_errors(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->postJson('/api/v1/jmap', [])
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:notRequest');

        $this->withBearer($token)->postJson('/api/v1/jmap', ['using' => [JmapCapabilities::CORE]])
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:notRequest');

        $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE],
            'methodCalls' => [['OnlyTwo', []]],
        ])
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:notRequest');
    }

    public function test_unsupported_capability_is_a_request_level_unknown_capability_error(): void
    {
        $this->jmap([['Core/echo', [], 'c0']], ['urn:ietf:params:jmap:mail'])
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:unknownCapability');
    }

    public function test_too_many_method_calls_is_a_request_level_limit_error(): void
    {
        $calls = [];
        for ($i = 0; $i <= JmapCapabilities::MAX_CALLS_IN_REQUEST; $i++) {
            $calls[] = ['Core/echo', [], 'c'.$i];
        }

        $this->jmap($calls)
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:limit')
            ->assertJsonPath('limit', 'maxCallsInRequest');
    }

    public function test_account_id_is_validated_for_data_methods(): void
    {
        // CalendarEvent/queryChanges requires accountId; Core/echo does not.
        $response = $this->jmap([
            ['CalendarEvent/queryChanges', [], 'c0'],
            ['CalendarEvent/queryChanges', ['accountId' => 'alice'], 'c1'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.1.type', 'invalidArguments');
        $response->assertJsonPath('methodResponses.1.1.type', 'accountNotFound');
    }

    public function test_query_changes_is_advertised_but_cannot_calculate_changes(): void
    {
        $this->jmap([
            ['CalendarEvent/queryChanges', ['accountId' => 'bob', 'sinceQueryState' => '0:'], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }
}
