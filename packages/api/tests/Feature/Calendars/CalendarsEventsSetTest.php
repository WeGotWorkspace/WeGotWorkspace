<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarsEventsSetTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_set_create_returns_server_set_object_keyed_by_creation_id(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'create' => [
                    'new-1' => $this->sampleCalendarEventPayload(),
                ],
            ]);

        $response->assertOk()
            ->assertJsonPath('created.new-1.id', fn ($id) => is_string($id) && $id !== '')
            ->assertJsonPath('created.new-1.state', fn ($state) => is_string($state) && $state !== '');

        $eventId = (string) $response->json('created.new-1.id');
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId)
            ->assertOk()
            ->assertJsonPath('title', 'New Event')
            ->assertJsonPath('state', fn ($state) => is_string($state) && $state !== '');
    }

    public function test_set_old_state_and_new_state_advance_and_match_changes_state(): void
    {
        $before = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default')
            ->assertOk();
        $stateBefore = (string) $before->json('newState');

        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'create' => ['new-1' => $this->sampleCalendarEventPayload()],
            ])
            ->assertOk();

        // Single touched calendar: set-level states are that calendar's /changes state.
        $this->assertSame($stateBefore, $set->json('oldState'));
        $newState = (string) $set->json('newState');
        $this->assertNotSame($stateBefore, $newState);

        $after = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=default')
            ->assertOk();
        $this->assertSame((string) $after->json('newState'), $newState);
    }

    public function test_set_states_compose_across_touched_calendars(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/calendars', ['name' => 'Second', 'id' => 'second'])
            ->assertCreated();

        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'create' => [
                    'in-default' => $this->sampleCalendarEventPayload(),
                    'in-second' => $this->sampleCalendarEventPayload('second'),
                ],
            ])
            ->assertOk();

        // Multiple touched calendars compose the collection-style state, sorted by uri.
        $this->assertMatchesRegularExpression('/^2:default:\d+,second:\d+$/', (string) $set->json('oldState'));
        $this->assertMatchesRegularExpression('/^2:default:\d+,second:\d+$/', (string) $set->json('newState'));
        $this->assertNotSame($set->json('oldState'), $set->json('newState'));
    }

    public function test_set_with_no_mutations_returns_equal_states(): void
    {
        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'destroy' => ['does-not-exist'],
            ])
            ->assertOk();

        $this->assertNotSame('', (string) $set->json('newState'));
        $this->assertSame($set->json('oldState'), $set->json('newState'));
    }

    public function test_set_update_with_if_in_state_rotates_state(): void
    {
        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events', $this->sampleCalendarEventPayload());
        $create->assertCreated();
        $eventId = (string) $create->json('id');
        $state = (string) $create->json('state');
        $this->assertNotSame('', $state);

        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'update' => [
                    $eventId => [
                        'ifInState' => $state,
                        'title' => 'After Set Update',
                    ],
                ],
            ]);

        $set->assertOk()
            ->assertJsonPath('updated.'.$eventId.'.state', fn ($next) => is_string($next) && $next !== '' && $next !== $state);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId)
            ->assertOk()
            ->assertJsonPath('title', 'After Set Update');
    }

    public function test_set_update_state_mismatch(): void
    {
        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events', $this->sampleCalendarEventPayload());
        $create->assertCreated();
        $eventId = (string) $create->json('id');

        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'update' => [
                    $eventId => [
                        'ifInState' => 'stale-token',
                        'title' => 'Should Not Apply',
                    ],
                ],
            ]);

        $set->assertOk()
            ->assertJsonPath('notUpdated.'.$eventId.'.type', 'stateMismatch');

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId)
            ->assertOk()
            ->assertJsonPath('title', 'New Event');
    }

    public function test_set_destroy_with_if_in_state(): void
    {
        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events', $this->sampleCalendarEventPayload());
        $create->assertCreated();
        $eventId = (string) $create->json('id');
        $state = (string) $create->json('state');

        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'destroy' => [
                    $eventId => ['ifInState' => $state],
                ],
            ]);

        $set->assertOk()
            ->assertJsonPath('destroyed', [$eventId]);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId)
            ->assertNotFound();
    }

    public function test_set_destroy_accepts_plain_id_list(): void
    {
        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events', $this->sampleCalendarEventPayload());
        $create->assertCreated();
        $eventId = (string) $create->json('id');

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'destroy' => [$eventId],
            ])
            ->assertOk()
            ->assertJsonPath('destroyed', [$eventId]);
    }

    public function test_set_destroy_unknown_event_reports_not_destroyed(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'destroy' => ['does-not-exist'],
            ])
            ->assertOk()
            ->assertJsonPath('notDestroyed.does-not-exist.type', 'notFound')
            ->assertJsonPath('destroyed', []);
    }

    public function test_set_create_validation_failure_reports_invalid_properties(): void
    {
        $payload = $this->sampleCalendarEventPayload();
        unset($payload['start']);

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'create' => ['no-start' => $payload],
            ])
            ->assertOk()
            ->assertJsonPath('notCreated.no-start.type', 'invalidProperties')
            ->assertJsonPath('notCreated.no-start.properties', ['start']);
    }

    public function test_set_partial_success_reports_all_six_buckets(): void
    {
        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events', $this->sampleCalendarEventPayload());
        $create->assertCreated();
        $eventId = (string) $create->json('id');

        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'create' => [
                    'ok-create' => $this->sampleCalendarEventPayload(),
                    'bad-create' => ['calendarIds' => ['nope' => true], 'title' => 'Broken', 'start' => '2026-09-01T10:00:00Z'],
                ],
                'update' => [
                    $eventId => ['ifInState' => 'stale-token', 'title' => 'Nope'],
                ],
                'destroy' => ['missing-event'],
            ]);

        $set->assertOk()
            ->assertJsonPath('created.ok-create.id', fn ($id) => is_string($id) && $id !== '')
            ->assertJsonPath('notCreated.bad-create.type', 'notFound')
            ->assertJsonPath('notUpdated.'.$eventId.'.type', 'stateMismatch')
            ->assertJsonPath('notDestroyed.missing-event.type', 'notFound')
            ->assertJsonPath('updated', [])
            ->assertJsonPath('destroyed', []);
    }
}
