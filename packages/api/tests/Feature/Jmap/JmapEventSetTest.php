<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CalendarObject;
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

    public function test_set_destroy_unknown_event_reports_not_destroyed(): void
    {
        $args = $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => ['does-not-exist']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('notFound', $args['notDestroyed']['does-not-exist']['type']);
        $this->assertSame([], $args['destroyed']);
    }

    public function test_set_create_missing_start_reports_invalid_properties(): void
    {
        $payload = $this->sampleCalendarEventPayload();
        unset($payload['start']);

        $args = $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['no-start' => $payload]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('invalidProperties', $args['notCreated']['no-start']['type']);
        $this->assertSame(['start'], $args['notCreated']['no-start']['properties']);
    }

    public function test_set_partial_success_reports_all_six_buckets(): void
    {
        $eventId = (string) $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => $this->sampleCalendarEventPayload()]], 'c'],
        ])->assertOk()->json('methodResponses.0.1.created.d.id');

        $args = $this->jmap([
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'create' => [
                    'ok-create' => $this->sampleCalendarEventPayload(),
                    'bad-create' => ['calendarIds' => ['nope' => true], 'title' => 'Broken', 'start' => '2026-09-01T10:00:00Z'],
                ],
                'update' => [
                    $eventId => ['ifInState' => 'stale-token', 'title' => 'Nope'],
                ],
                'destroy' => ['missing-event'],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertNotSame('', (string) $args['created']['ok-create']['id']);
        $this->assertSame('notFound', $args['notCreated']['bad-create']['type']);
        $this->assertSame('stateMismatch', $args['notUpdated'][$eventId]['type']);
        $this->assertSame('notFound', $args['notDestroyed']['missing-event']['type']);
        $this->assertSame([], $args['updated']);
        $this->assertSame([], $args['destroyed']);
    }

    public function test_set_updates_and_destroys_only_the_target_vevent_in_a_composite_object(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:first\r\nSUMMARY:Primary Event\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:second\r\nSUMMARY:Secondary Event\r\nDTSTART:20260611T090000Z\r\nDTEND:20260611T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'multi-event.ics', $ics);

        $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => ['multi-event#second' => ['title' => 'Patched Secondary']]], 'u'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.notUpdated.multi-event#second', null);

        $stored = CalendarObject::query()->where('uri', 'multi-event.ics')->first();
        $this->assertNotNull($stored);
        $blob = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('SUMMARY:Primary Event', $blob);
        $this->assertStringContainsString('SUMMARY:Patched Secondary', $blob);
        $this->assertStringNotContainsString('SUMMARY:Secondary Event', $blob);

        $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => ['multi-event#second']], 'd'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', 'multi-event#second');

        $stored = CalendarObject::query()->where('uri', 'multi-event.ics')->first();
        $this->assertNotNull($stored);
        $blob = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('SUMMARY:Primary Event', $blob);
        $this->assertStringNotContainsString('UID:second', $blob);
    }

    public function test_set_destroy_last_vevent_removes_the_calendar_object(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:only\r\nSUMMARY:Solo Event\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'solo-event.ics', $ics);

        $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'd'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $eventId);

        $this->assertNull(CalendarObject::query()->where('uri', 'solo-event.ics')->first());
    }

    public function test_set_recurrence_overrides_updates_a_single_instance_in_ics(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:series-patch\r\nSUMMARY:Daily Standup\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T093000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'daily-standup.ics', $ics);

        $event = $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => [
                'recurrenceOverrides' => [
                    '2026-06-12T09:00:00Z' => [
                        'start' => '2026-06-12T14:00:00Z',
                        'end' => '2026-06-12T14:30:00Z',
                        'title' => 'Daily Standup (rescheduled)',
                    ],
                    '2026-06-13T09:00:00Z' => [
                        'excluded' => true,
                    ],
                ],
            ]]], 'u'],
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'g'],
        ])->assertOk();

        $this->assertSame(
            '2026-06-12T14:00:00Z',
            $event->json('methodResponses.1.1.list.0.recurrenceOverrides.2026-06-12T09:00:00Z.start'),
        );
        $this->assertTrue($event->json('methodResponses.1.1.list.0.recurrenceOverrides.2026-06-13T09:00:00Z.excluded'));

        $stored = CalendarObject::query()->where('uri', 'daily-standup.ics')->first();
        $this->assertNotNull($stored);
        $blob = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('RRULE:FREQ=DAILY', $blob);
        $this->assertStringContainsString('RECURRENCE-ID:20260612T090000Z', $blob);
        $this->assertStringContainsString('DTSTART:20260612T140000Z', $blob);
        $this->assertStringContainsString('SUMMARY:Daily Standup (rescheduled)', $blob);
        $this->assertStringContainsString('RECURRENCE-ID:20260613T090000Z', $blob);
        $this->assertStringContainsString('STATUS:CANCELLED', $blob);
    }
}
