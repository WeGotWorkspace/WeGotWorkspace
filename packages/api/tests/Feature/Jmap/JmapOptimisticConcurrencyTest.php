<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CalendarObject;
use App\Services\Jmap\JmapCapabilities;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class JmapOptimisticConcurrencyTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setUpTasksFixtures();
        $this->seedDefaultCalendarFor('bob');
        $this->seedInboxTaskListFor('bob');
    }

    public function test_calendar_event_stale_if_in_state_is_state_mismatch(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'team-meeting.ics', $this->sampleIcs('Team Meeting'));
        $state = $this->currentCalendarEventState();

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['CalendarEvent/set', ['accountId' => 'bob', 'ifInState' => $state, 'update' => [$eventId => ['title' => 'First update']]], 'c0'],
            ],
        ])->assertOk()->assertJsonPath('methodResponses.0.0', 'CalendarEvent/set');

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['CalendarEvent/set', ['accountId' => 'bob', 'ifInState' => $state, 'update' => [$eventId => ['title' => 'Lost update']]], 'c0'],
            ],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'stateMismatch');
    }

    public function test_multi_vevent_composite_update_rejects_stale_account_state(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:first\r\nSUMMARY:Primary Event\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:second\r\nSUMMARY:Secondary Event\r\nDTSTART:20260611T090000Z\r\nDTEND:20260611T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'multi-event.ics', $ics);
        $state = $this->currentCalendarEventState();

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['CalendarEvent/set', ['accountId' => 'bob', 'ifInState' => $state, 'update' => ['multi-event#second' => ['title' => 'Patched Secondary']]], 'c0'],
            ],
        ])->assertOk()->assertJsonPath('methodResponses.0.0', 'CalendarEvent/set');

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['CalendarEvent/set', ['accountId' => 'bob', 'ifInState' => $state, 'update' => ['multi-event#first' => ['title' => 'Stale primary patch']]], 'c0'],
            ],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'stateMismatch');

        $freshState = $this->currentCalendarEventState();
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['CalendarEvent/set', ['accountId' => 'bob', 'ifInState' => $freshState, 'update' => ['multi-event#first' => ['title' => 'Fresh primary patch']]], 'c0'],
            ],
        ])->assertOk()->assertJsonPath('methodResponses.0.0', 'CalendarEvent/set');

        $stored = CalendarObject::query()->where('uri', 'multi-event.ics')->first();
        $this->assertNotNull($stored);
        $blob = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('SUMMARY:Fresh primary patch', $blob);
        $this->assertStringContainsString('SUMMARY:Patched Secondary', $blob);
    }

    private function currentCalendarEventState(): string
    {
        return (string) $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => []], 's'],
            ],
        ])->assertOk()->json('methodResponses.0.1.state');
    }

    public function test_task_stale_if_match_returns_412(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));
        $url = '/api/v1/tasks/items/'.$taskId;
        $staleEtag = $this->fetchEtagFromGet($url);

        $this->withBearer($this->userBearerToken())
            ->patchJson($url, ['title' => 'First update'], $this->withIfMatch($staleEtag))
            ->assertOk();

        $this->withBearer($this->userBearerToken())
            ->patchJson($url, ['title' => 'Lost update'], $this->withIfMatch($staleEtag))
            ->assertStatus(412)
            ->assertJsonPath('code', 'precondition_failed');
    }

    public function test_task_delete_requires_matching_if_match(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));
        $url = '/api/v1/tasks/items/'.$taskId;
        $etag = $this->fetchEtagFromGet($url);

        $this->withBearer($this->userBearerToken())
            ->deleteJson($url, [], $this->withIfMatch('"wrong-etag"'))
            ->assertStatus(412)
            ->assertJsonPath('code', 'precondition_failed');

        $this->withBearer($this->userBearerToken())
            ->deleteJson($url, [], $this->withIfMatch($etag))
            ->assertOk()
            ->assertJsonPath('ok', true);
    }

    public function test_mutation_without_precondition_header_returns_412(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));

        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/tasks/items/'.$taskId, ['title' => 'No precondition'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'precondition_failed');
    }
}
