<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarObject;
use App\Services\Tasks\Conversion\IcsJmapTaskConverter;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * CalDAV ↔ REST round-trip interoperability for the tasks domain.
 */
final class TasksCalDavInteropTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    public function test_rest_create_persists_readable_vtodo_in_caldav_storage(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $payload = [
            'uid' => $uid,
            'taskListIds' => [InboxTaskListProvisioner::URI => true],
            'title' => 'Interop Task',
            'due' => '2026-06-15T09:00:00',
        ];

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', $payload);

        $response->assertCreated();
        $taskId = (string) $response->json('id');
        $this->assertNotSame('', $taskId);

        $stored = $this->findBobTask($taskId);
        $this->assertNotNull($stored, 'REST-created task should exist in CalDAV calendarobjects table.');

        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('SUMMARY:Interop Task', $ics);
        $this->assertStringContainsString('UID:'.$uid, $ics);
        $this->assertStringContainsString('BEGIN:VTODO', $ics);
    }

    public function test_rest_create_updates_caldav_search_index(): void
    {
        $payload = [
            'taskListIds' => [InboxTaskListProvisioner::URI => true],
            'title' => 'Searchable Interop Task',
        ];

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', $payload);

        $response->assertCreated();
        $taskId = (string) $response->json('id');
        $stored = $this->findBobTask($taskId);
        $this->assertNotNull($stored);

        $sourceKey = $this->calendarDavSearchSourceKey('bob', InboxTaskListProvisioner::URI, (string) $stored->uri);
        $row = DB::connection('wgw')->table('search_documents')
            ->where('source_type', 'caldav')
            ->where('source_key', $sourceKey)
            ->first();

        $this->assertNotNull($row, 'REST create should index the CalDAV task.');
        $this->assertSame('bob', $row->owner_username);
        $this->assertStringContainsString('Searchable Interop Task', (string) $row->title);

        $search = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/search/results?'.http_build_query([
                'q' => 'Searchable Interop',
                'sources' => ['caldav'],
                'limit' => 10,
            ]));

        $search->assertOk();
        $sourceTypes = array_map(
            static fn (array $hit): string => (string) ($hit['sourceType'] ?? ''),
            $search->json('data.results') ?? [],
        );
        $this->assertContains('caldav', $sourceTypes);
    }

    public function test_patch_completes_apple_reminders_uppercase_uuid_object(): void
    {
        $objectId = 'D69FDC67-DE9B-4DD4-9D98-DF226D7E9144';
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//macOS 15.0.1//EN\r\nBEGIN:VTODO\r\nUID:{$objectId}\r\nSUMMARY:From Reminders\r\nSTATUS:NEEDS-ACTION\r\nPERCENT-COMPLETE:0\r\nX-APPLE-SORT-ORDER:1\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $taskId = $this->seedTaskViaPdo('bob', $objectId.'.ics', $ics);
        $this->assertSame($objectId, $taskId);
        $url = '/api/v1/tasks/items/'.$taskId;

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)
            ->assertOk()
            ->assertJsonPath('list.0.id', $taskId);

        $response = $this->withBearer($this->userBearerToken())
            ->patchJson($url, [
                'workflowStatus' => 'completed',
            ], $this->withIfMatch($this->fetchEtagFromGet($url)));

        $response->assertOk()
            ->assertJsonPath('id', $taskId)
            ->assertJsonPath('workflowStatus', 'completed');
    }

    public function test_caldav_write_is_readable_via_rest_get(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:{$uid}\r\nSUMMARY:CalDAV Writer\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $taskId = $this->seedTaskViaPdo('bob', 'caldav-writer.ics', $ics);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId);

        $response->assertOk()
            ->assertJsonPath('id', $taskId)
            ->assertJsonPath('@type', 'Task')
            ->assertJsonPath('uid', $uid)
            ->assertJsonPath('taskListId', InboxTaskListProvisioner::URI)
            ->assertJsonPath('title', 'CalDAV Writer')
            ->assertJsonPath('workflowStatus', 'needs-action');
    }

    public function test_caldav_update_is_reflected_in_rest_get(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $initial = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:{$uid}\r\nSUMMARY:Before Update\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $taskId = $this->seedTaskViaPdo('bob', 'round-trip-update.ics', $initial);

        $updated = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:{$uid}\r\nSUMMARY:After CalDAV Update\r\nSTATUS:COMPLETED\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $this->updateTaskViaPdo('bob', 'round-trip-update.ics', $updated);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId);

        $response->assertOk()
            ->assertJsonPath('title', 'After CalDAV Update')
            ->assertJsonPath('workflowStatus', 'completed');
    }

    public function test_caldav_recurring_task_readable_via_rest_get(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:{$uid}\r\nSUMMARY:Daily standup\r\nDUE:20260601T090000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $taskId = $this->seedTaskViaPdo('bob', 'recurring-caldav.ics', $ics);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId);

        $response->assertOk()
            ->assertJsonPath('uid', $uid)
            ->assertJsonCount(1, 'recurrenceRules')
            ->assertJsonPath('recurrenceRules.0.frequency', 'daily')
            ->assertJsonPath('recurrenceRules.0.count', 3);
    }

    public function test_rest_create_with_alert_visible_in_caldav_storage(): void
    {
        $payload = [
            'taskListIds' => [InboxTaskListProvisioner::URI => true],
            'title' => 'Task with reminder',
            'due' => '2026-06-15T17:00:00',
            'alerts' => [
                'reminder' => [
                    '@type' => 'Alert',
                    'trigger' => [
                        '@type' => 'OffsetTrigger',
                        'offset' => '-PT30M',
                        'relativeTo' => 'end',
                    ],
                ],
            ],
        ];

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', $payload);

        $response->assertCreated()
            ->assertJsonPath('alerts.alert1.trigger.offset', '-PT30M')
            ->assertJsonPath('alerts.alert1.trigger.relativeTo', 'end');

        $taskId = (string) $response->json('id');
        $stored = $this->findBobTask($taskId);
        $this->assertNotNull($stored);

        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('BEGIN:VALARM', $ics);
        $this->assertStringContainsString('TRIGGER;RELATED=END:-PT30M', $ics);
    }

    public function test_rest_patch_alerts_null_clears_valarm_from_caldav_storage(): void
    {
        $payload = [
            'taskListIds' => [InboxTaskListProvisioner::URI => true],
            'title' => 'Task with reminder to clear',
            'due' => '2026-06-15T17:00:00',
            'alerts' => [
                'reminder' => [
                    '@type' => 'Alert',
                    'trigger' => [
                        '@type' => 'OffsetTrigger',
                        'offset' => '-PT30M',
                        'relativeTo' => 'end',
                    ],
                ],
            ],
        ];

        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', $payload);

        $create->assertCreated()
            ->assertJsonPath('alerts.alert1.trigger.offset', '-PT30M');

        $taskId = (string) $create->json('id');
        $url = '/api/v1/tasks/items/'.$taskId;

        $response = $this->withBearer($this->userBearerToken())
            ->patchJson($url, [
                'alerts' => null,
            ], $this->withIfMatch($this->fetchEtagFromGet($url)));

        $response->assertOk()
            ->assertJsonMissingPath('alerts');

        $stored = $this->findBobTask($taskId);
        $this->assertNotNull($stored);

        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringNotContainsString('BEGIN:VALARM', $ics);
    }

    public function test_caldav_all_day_task_readable_via_rest_get(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:{$uid}\r\nSUMMARY:All day from CalDAV\r\nDUE;VALUE=DATE:20260620\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $taskId = $this->seedTaskViaPdo('bob', 'all-day-caldav.ics', $ics);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId);

        $response->assertOk()
            ->assertJsonPath('showWithoutTime', true)
            ->assertJsonPath('due', '2026-06-20');
    }

    public function test_caldav_participants_readable_via_rest_get(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:{$uid}\r\nSUMMARY:Delegated\r\nDUE:20260615T090000\r\nORGANIZER;CN=Alice:mailto:alice@example.com\r\nATTENDEE;CN=Bob;PARTSTAT=NEEDS-ACTION:mailto:bob@example.com\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $taskId = $this->seedTaskViaPdo('bob', 'participants-caldav.ics', $ics);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId);

        $response->assertOk()
            ->assertJsonPath('participants.org.email', 'alice@example.com')
            ->assertJsonPath('participants.att1.email', 'bob@example.com');
    }

    public function test_rest_create_with_ics_props_persists_to_caldav(): void
    {
        $payload = [
            'taskListIds' => [InboxTaskListProvisioner::URI => true],
            'title' => 'Custom props task',
            'due' => '2026-06-15T09:00:00',
            'icsProps' => [
                'X-CUSTOM-PROP' => 'client-extension',
            ],
        ];

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', $payload);

        $response->assertCreated()
            ->assertJsonPath('icsProps.X-CUSTOM-PROP', 'client-extension');

        $taskId = (string) $response->json('id');
        $stored = $this->findBobTask($taskId);
        $this->assertNotNull($stored);

        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('X-CUSTOM-PROP:client-extension', $ics);
    }

    private function findBobTask(string $taskId): ?CalendarObject
    {
        $parsed = IcsJmapTaskConverter::parseTaskId($taskId);
        $objectUri = $parsed['objectUri'];

        $row = CalendarObject::query()
            ->from('calendarobjects as o')
            ->join('calendarinstances as i', 'i.calendarid', '=', 'o.calendarid')
            ->where('o.uri', $objectUri)
            ->where('i.principaluri', 'principals/bob')
            ->select('o.id')
            ->first();

        if ($row === null) {
            return null;
        }

        return CalendarObject::query()->find((int) $row->id);
    }

    private function calendarDavSearchSourceKey(string $username, string $calendarUri, string $objectUri): string
    {
        return $username.'|'.$calendarUri.'|'.$objectUri;
    }
}
