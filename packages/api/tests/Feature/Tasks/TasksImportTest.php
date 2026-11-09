<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Events\EventDispatch;
use App\Events\WorkspaceEvent;
use App\Events\WorkspaceEventListener;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Tasks\InboxTaskListProvisioner;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class TasksImportTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    public function test_vtodo_only_file_imports_every_uid_group(): void
    {
        $response = $this->importIcs($this->calendar(
            $this->vtodo('todo-one@example.test', 'First imported task'),
            $this->vtodo('todo-two@example.test', 'Second imported task'),
        ));

        $response->assertCreated()
            ->assertJsonCount(2, 'list')
            ->assertJsonCount(0, 'errors')
            ->assertJsonPath('skipped.events', 0)
            ->assertJsonPath('list.0.taskListId', InboxTaskListProvisioner::URI);
        $titles = collect($response->json('list'))->pluck('title')->all();
        $this->assertEqualsCanonicalizing(['First imported task', 'Second imported task'], $titles);

        $listed = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)
            ->assertOk();
        $this->assertCount(2, $listed->json('list'));
    }

    public function test_group_ics_is_stored_as_is_with_related_to_alarm_rrule_and_unknown_properties(): void
    {
        $todo = "BEGIN:VTODO\r\nUID:kept@example.test\r\nSUMMARY:Kept as-is\r\nRELATED-TO:parent@example.test\r\n"
            ."RRULE:FREQ=WEEKLY;BYDAY=MO\r\nDTSTART:20261102T090000Z\r\nX-VENDOR-FLAG:keep-me\r\n"
            ."BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VTODO";

        $this->importIcs($this->calendar($todo))->assertCreated();

        $stored = $this->storedIcs('kept@example.test');
        foreach (['RELATED-TO:parent@example.test', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'X-VENDOR-FLAG:keep-me', 'BEGIN:VALARM'] as $line) {
            $this->assertStringContainsString($line, $stored);
        }
    }

    public function test_due_time_zone_is_carried_into_the_group(): void
    {
        $zone = "BEGIN:VTIMEZONE\r\nTZID:Europe/Amsterdam\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\n"
            ."TZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nEND:STANDARD\r\nEND:VTIMEZONE";
        $todo = "BEGIN:VTODO\r\nUID:zoned@example.test\r\nSUMMARY:Zoned\r\nDUE;TZID=Europe/Amsterdam:20261110T170000\r\nEND:VTODO";

        $this->importIcs($this->calendar($zone, $todo))->assertCreated();

        $this->assertStringContainsString('TZID:Europe/Amsterdam', $this->storedIcs('zoned@example.test'));
    }

    public function test_mixed_file_imports_tasks_and_counts_skipped_events(): void
    {
        $response = $this->importIcs($this->calendar(
            "BEGIN:VEVENT\r\nUID:event-a@example.test\r\nSUMMARY:An event\r\nDTSTART:20261101T090000Z\r\nEND:VEVENT",
            "BEGIN:VEVENT\r\nUID:event-b@example.test\r\nSUMMARY:Another event\r\nDTSTART:20261102T090000Z\r\nEND:VEVENT",
            "BEGIN:VEVENT\r\nUID:event-b@example.test\r\nRECURRENCE-ID:20261102T090000Z\r\nSUMMARY:Override\r\nDTSTART:20261102T100000Z\r\nEND:VEVENT",
            $this->vtodo('mixed-todo@example.test', 'A task'),
        ));

        $response->assertCreated()
            ->assertJsonCount(1, 'list')
            ->assertJsonPath('list.0.title', 'A task')
            ->assertJsonPath('skipped.events', 2);
        $this->assertSame(0, CalendarObject::query()->where('componenttype', 'VEVENT')->where('uid', 'like', 'event-%')->count());
    }

    public function test_completed_tasks_keep_their_status(): void
    {
        $todo = "BEGIN:VTODO\r\nUID:done@example.test\r\nSUMMARY:Already done\r\nSTATUS:COMPLETED\r\n"
            ."COMPLETED:20261101T120000Z\r\nPERCENT-COMPLETE:100\r\nEND:VTODO";

        $this->importIcs($this->calendar($todo))
            ->assertCreated()
            ->assertJsonPath('list.0.workflowStatus', 'completed');
    }

    public function test_group_over_component_cap_is_an_error_and_siblings_import(): void
    {
        $chunks = [];
        for ($i = 0; $i < VObjectPayloadGuard::MAX_ICALENDAR_COMPONENTS + 1; $i++) {
            $rid = sprintf('202607%02dT090000Z', ($i % 28) + 1);
            $chunks[] = "BEGIN:VTODO\r\nUID:over-cap@example.test\r\nRECURRENCE-ID:{$rid}\r\nSUMMARY:Over cap\r\nEND:VTODO";
        }
        $ics = $this->calendar($this->vtodo('good-sibling@example.test', 'Good sibling'), ...$chunks);
        $this->assertLessThanOrEqual(VObjectPayloadGuard::MAX_ICS_IMPORT_BYTES, strlen($ics));

        $response = $this->importIcs($ics)->assertCreated();

        $this->assertCount(1, $response->json('list'));
        $this->assertSame('Good sibling', $response->json('list.0.title'));
        $response->assertJsonCount(1, 'errors')
            ->assertJsonPath('errors.0.index', 1)
            ->assertJsonPath('errors.0.code', 'payload_too_complex')
            ->assertJsonPath('errors.0.uid', 'over-cap@example.test')
            ->assertJsonPath('errors.0.title', 'Over cap');
    }

    public function test_minutely_recurrence_is_an_error_and_siblings_import(): void
    {
        $bad = "BEGIN:VTODO\r\nUID:minutely@example.test\r\nSUMMARY:Too often\r\nDTSTART:20261101T090000Z\r\nRRULE:FREQ=MINUTELY\r\nEND:VTODO";

        $response = $this->importIcs($this->calendar($bad, $this->vtodo('fine@example.test', 'Fine')))
            ->assertCreated()
            ->assertJsonCount(1, 'list')
            ->assertJsonCount(1, 'errors');

        $this->assertSame('minutely@example.test', $response->json('errors.0.uid'));
        $this->assertNull($this->storedObject('minutely@example.test'));
    }

    public function test_existing_uid_is_an_error_and_not_overwritten(): void
    {
        $this->importIcs($this->calendar($this->vtodo('dup@example.test', 'Original')))->assertCreated();

        $response = $this->importIcs($this->calendar($this->vtodo('dup@example.test', 'Replacement')));

        $response->assertStatus(400)
            ->assertJsonCount(0, 'list')
            ->assertJsonCount(1, 'errors')
            ->assertJsonPath('errors.0.code', 'already_exists')
            ->assertJsonPath('errors.0.title', 'Replacement')
            ->assertJsonPath('skipped.events', 0);
        $this->assertSame(1, CalendarObject::query()->where('uid', 'dup@example.test')->count());
        $this->assertStringContainsString('SUMMARY:Original', $this->storedIcs('dup@example.test'));
    }

    public function test_same_uid_in_another_list_still_imports(): void
    {
        $this->importIcs($this->calendar($this->vtodo('elsewhere@example.test', 'In inbox')))->assertCreated();
        $listId = $this->createList('Second list');

        $this->importIcs($this->calendar($this->vtodo('elsewhere@example.test', 'In second')), $listId)
            ->assertCreated()
            ->assertJsonPath('list.0.taskListId', $listId);
    }

    public function test_read_only_list_returns_403(): void
    {
        $listId = $this->createList('Read only');
        CalendarInstance::query()
            ->where('principaluri', 'principals/bob')
            ->where('uri', $listId)
            ->update(['access' => 2]);

        $this->importIcs($this->calendar($this->vtodo('ro@example.test', 'Nope')), $listId)
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
        $this->assertNull($this->storedObject('ro@example.test'));
    }

    public function test_unknown_and_foreign_list_return_404(): void
    {
        $this->importIcs($this->calendar($this->vtodo('x@example.test', 'X')), 'missing-list')->assertNotFound();

        $carolList = (string) $this->withBearer($this->issueBearerTokenFor('carol'))
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Carol only'])
            ->assertCreated()
            ->json('id');

        $this->importIcs($this->calendar($this->vtodo('y@example.test', 'Y')), $carolList)->assertNotFound();
    }

    public function test_missing_list_id_empty_unreadable_and_event_only_bodies_return_400(): void
    {
        $this->call('POST', '/api/v1/tasks/items/import', [], [], [], $this->importHeaders(), $this->calendar($this->vtodo('a@example.test', 'A')))
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
        $this->importIcs('')->assertStatus(400)->assertJsonPath('code', 'bad_request');
        $this->importIcs('not an ics file')->assertStatus(400)->assertJsonPath('code', 'bad_request');
        $this->importIcs($this->calendar("BEGIN:VEVENT\r\nUID:only-event@example.test\r\nSUMMARY:Event\r\nDTSTART:20261101T090000Z\r\nEND:VEVENT"))
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request')
            ->assertJsonPath('error', 'No VTODO data found.');
    }

    public function test_body_over_the_import_limit_returns_413(): void
    {
        $this->importIcs(str_repeat('A', VObjectPayloadGuard::MAX_ICS_IMPORT_BYTES + 1))
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    }

    public function test_imported_tasks_are_indexed_and_fire_one_mutation_event_each(): void
    {
        $events = [];
        app(EventDispatch::class)->listen(new class($events) implements WorkspaceEventListener
        {
            /** @param  list<WorkspaceEvent>  $events */
            public function __construct(private array &$events) {}

            public function handle(WorkspaceEvent $event): void
            {
                $this->events[] = $event;
            }
        });

        $this->importIcs($this->calendar(
            $this->vtodo('indexed-one@example.test', 'Searchable import one'),
            $this->vtodo('indexed-two@example.test', 'Searchable import two'),
        ))->assertCreated();

        $rows = DB::connection('wgw')->table('search_documents')
            ->where('source_type', 'caldav')
            ->where('owner_username', 'bob')
            ->where('title', 'like', 'Searchable import%')
            ->count();
        $this->assertSame(2, $rows);

        $taskEvents = array_values(array_filter(
            $events,
            static fn (WorkspaceEvent $event): bool => $event->domain === 'tasks' && $event->action === 'created',
        ));
        $this->assertCount(2, $taskEvents);
    }

    private function importIcs(string $ics, string $taskListId = InboxTaskListProvisioner::URI): TestResponse
    {
        return $this->call(
            'POST',
            '/api/v1/tasks/items/import?taskListId='.rawurlencode($taskListId),
            [],
            [],
            [],
            $this->importHeaders(),
            $ics,
        );
    }

    /**
     * @return array<string, string>
     */
    private function importHeaders(): array
    {
        return [
            'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
            'CONTENT_TYPE' => 'text/calendar',
            'HTTP_ACCEPT' => 'application/json',
        ];
    }

    private function createList(string $name): string
    {
        return (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/tasklists', ['name' => $name])
            ->assertCreated()
            ->json('id');
    }

    private function calendar(string ...$components): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Import//EN\r\n".implode("\r\n", $components)."\r\nEND:VCALENDAR\r\n";
    }

    private function vtodo(string $uid, string $summary): string
    {
        return "BEGIN:VTODO\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO";
    }

    private function storedObject(string $uid): ?CalendarObject
    {
        return CalendarObject::query()->where('uid', $uid)->first();
    }

    private function storedIcs(string $uid): string
    {
        $object = $this->storedObject($uid);
        $this->assertNotNull($object, 'No stored object for '.$uid);

        return is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
    }
}
