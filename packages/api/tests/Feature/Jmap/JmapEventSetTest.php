<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * CalendarEvent/set with genuine top-level ifInState and account-wide
 * oldState/newState recomposition (chunk E, spec §5): stateMismatch must
 * leave the data untouched, and the returned newState must feed straight
 * back into CalendarEvent/changes on a single-calendar account — the
 * mismatch-13 regression this whole state design exists to prevent.
 */
final class JmapEventSetTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function currentEventState(): string
    {
        return (string) $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => []], 's'],
        ])->assertOk()->json('methodResponses.0.1.state');
    }

    /**
     * @return list<string>
     */
    private function allEventIds(): array
    {
        $list = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => null], 'g'],
        ])->assertOk()->json('methodResponses.0.1.list');

        return array_column($list, 'id');
    }

    public function test_set_without_if_in_state_creates_with_rfc_shapes_and_account_wide_states(): void
    {
        $args = $this->jmap([
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'create' => ['draft-1' => $this->sampleCalendarEventPayload()],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('bob', $args['accountId']);

        // created maps creationId => {id, state} (server-set properties).
        $created = $args['created']['draft-1'];
        $this->assertNotSame('', (string) $created['id']);
        $this->assertNotSame('', (string) $created['state']);

        // Top-level states are envelope-composed account-wide, not the
        // service's touched-calendar bare token.
        $oldTokens = JmapAccountStateCodec::decompose($args['oldState']);
        $newTokens = JmapAccountStateCodec::decompose($args['newState']);
        $this->assertIsArray($oldTokens);
        $this->assertIsArray($newTokens);
        $this->assertNotSame($args['oldState'], $args['newState']);
        $this->assertArrayHasKey('default', $newTokens);
    }

    public function test_set_updates_and_destroys_with_pass_through_item_shapes(): void
    {
        $eventId = (string) $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => $this->sampleCalendarEventPayload()]], 'c'],
        ])->assertOk()->json('methodResponses.0.1.created.d.id');

        $update = $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => ['title' => 'Retitled']]], 'u'],
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'g'],
        ])->assertOk();

        // updated maps id => {state} (the server-changed state token).
        $this->assertNotSame('', (string) $update->json('methodResponses.0.1.updated.'.$eventId.'.state'));
        $this->assertSame('Retitled', $update->json('methodResponses.1.1.list.0.title'));

        $destroy = $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'd'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$eventId], $destroy['destroyed']);
        $this->assertNotContains($eventId, $this->allEventIds());
    }

    public function test_set_with_matching_if_in_state_proceeds(): void
    {
        $state = $this->currentEventState();

        $args = $this->jmap([
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'ifInState' => $state,
                'create' => ['d' => $this->sampleCalendarEventPayload()],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertArrayHasKey('d', $args['created']);
        $this->assertSame($state, $args['oldState']);
    }

    public function test_set_with_stale_if_in_state_is_a_state_mismatch_and_mutates_nothing(): void
    {
        $idsBefore = $this->allEventIds();
        $stale = '1:default:999999';

        $response = $this->jmap([
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'ifInState' => $stale,
                'create' => ['d' => $this->sampleCalendarEventPayload()],
            ], 'c0'],
        ])->assertOk();

        $response->assertJsonPath('methodResponses.0.0', 'error');
        $response->assertJsonPath('methodResponses.0.1.type', 'stateMismatch');

        // The service was never called: no event appeared, state unchanged.
        $this->assertSame($idsBefore, $this->allEventIds());
    }

    public function test_returned_new_state_feeds_incremental_changes_on_a_single_calendar_account(): void
    {
        // Mismatch-13 regression: the write-then-sync leg. bob owns exactly
        // one calendar, so the service's own newState would be a bare
        // undecomposable synctoken; the envelope must recompose it.
        $preState = $this->currentEventState();

        $set = $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => $this->sampleCalendarEventPayload()]], 'c'],
        ])->assertOk()->json('methodResponses.0.1');
        $eventId = (string) $set['created']['d']['id'];
        $newState = (string) $set['newState'];

        // The incremental path must work — no cannotCalculateChanges fallback.
        $sync = $this->jmap([
            ['CalendarEvent/changes', ['accountId' => 'bob', 'sinceState' => $preState], 'c'],
        ])->assertOk();
        $sync->assertJsonPath('methodResponses.0.0', 'CalendarEvent/changes');
        $this->assertContains($eventId, $sync->json('methodResponses.0.1.created'));

        $idle = $this->jmap([
            ['CalendarEvent/changes', ['accountId' => 'bob', 'sinceState' => $newState], 'c'],
        ])->assertOk();
        $idle->assertJsonPath('methodResponses.0.0', 'CalendarEvent/changes');
        $this->assertSame([], $idle->json('methodResponses.0.1.created'));
    }

    public function test_set_states_span_all_calendars_even_when_only_one_is_touched(): void
    {
        $secondCalendarId = (string) $this->jmap([
            ['Calendar/set', ['accountId' => 'bob', 'create' => ['c' => ['name' => 'Untouched']]], 'c'],
        ])->assertOk()->json('methodResponses.0.1.created.c.id');

        $args = $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => $this->sampleCalendarEventPayload()]], 's'],
        ])->assertOk()->json('methodResponses.0.1');

        // The service scopes states to touched calendars; the envelope must
        // recompose account-wide so untouched calendars stay represented.
        foreach (['oldState', 'newState'] as $field) {
            $tokens = JmapAccountStateCodec::decompose($args[$field]);
            $this->assertArrayHasKey('default', $tokens, $field);
            $this->assertArrayHasKey($secondCalendarId, $tokens, $field);
        }
    }

    public function test_invalid_create_payload_surfaces_invalid_properties_set_error(): void
    {
        $args = $this->jmap([
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'create' => ['bad' => ['title' => 'No calendar ids']],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([], $args['created']);
        $error = $args['notCreated']['bad'];
        $this->assertSame('invalidProperties', $error['type']);
        $this->assertArrayHasKey('properties', $error);
    }
}
