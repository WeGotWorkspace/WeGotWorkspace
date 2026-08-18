<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CalendarObject;
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

    public function test_calendar_event_stale_if_match_returns_412(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'team-meeting.ics', $this->sampleIcs('Team Meeting'));
        $url = '/api/v1/calendars/events/'.$eventId;
        $staleEtag = $this->fetchEtagFromGet($url);

        $this->withBearer($this->userBearerToken())
            ->patchJson($url, ['title' => 'First update'], $this->withIfMatch($staleEtag))
            ->assertOk();

        $this->withBearer($this->userBearerToken())
            ->patchJson($url, ['title' => 'Lost update'], $this->withIfMatch($staleEtag))
            ->assertStatus(412)
            ->assertJsonPath('code', 'precondition_failed');
    }

    public function test_multi_vevent_composite_id_shares_object_etag_and_rejects_stale_patch(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:first\r\nSUMMARY:Primary Event\r\nDTSTART:20260610T090000Z\r\nDTEND:20260610T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:second\r\nSUMMARY:Secondary Event\r\nDTSTART:20260611T090000Z\r\nDTEND:20260611T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $this->seedEventViaPdo('bob', 'multi-event.ics', $ics);

        $firstUrl = '/api/v1/calendars/events/'.rawurlencode('multi-event#first');
        $secondUrl = '/api/v1/calendars/events/'.rawurlencode('multi-event#second');

        $sharedEtag = $this->fetchEtagFromGet($firstUrl);
        $this->assertSame($sharedEtag, $this->fetchEtagFromGet($secondUrl));

        $this->withBearer($this->userBearerToken())
            ->patchJson($secondUrl, ['title' => 'Patched Secondary'], $this->withIfMatch($sharedEtag))
            ->assertOk()
            ->assertJsonPath('title', 'Patched Secondary');

        $this->withBearer($this->userBearerToken())
            ->patchJson($firstUrl, ['title' => 'Stale primary patch'], $this->withIfMatch($sharedEtag))
            ->assertStatus(412)
            ->assertJsonPath('code', 'precondition_failed');

        $freshEtag = $this->fetchEtagFromGet($firstUrl);
        $this->withBearer($this->userBearerToken())
            ->patchJson($firstUrl, ['title' => 'Fresh primary patch'], $this->withIfMatch($freshEtag))
            ->assertOk()
            ->assertJsonPath('title', 'Fresh primary patch');

        $stored = CalendarObject::query()->where('uri', 'multi-event.ics')->first();
        $this->assertNotNull($stored);
        $blob = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('SUMMARY:Fresh primary patch', $blob);
        $this->assertStringContainsString('SUMMARY:Patched Secondary', $blob);
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
