<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarObject;
use App\Services\Tasks\Conversion\IcsJmapTaskConverter;
use App\Services\Tasks\InboxTaskListProvisioner;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class TasksTasksTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    public function test_list_tasks_in_task_list(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI);

        $response->assertOk()
            ->assertJsonCount(1, 'list')
            ->assertJsonPath('list.0.id', $taskId)
            ->assertJsonPath('list.0.@type', 'Task')
            ->assertJsonPath('list.0.taskListId', InboxTaskListProvisioner::URI)
            ->assertJsonPath('list.0.title', 'Buy milk');
    }

    public function test_show_task(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId);

        $response->assertOk()
            ->assertJsonPath('id', $taskId)
            ->assertJsonPath('@type', 'Task')
            ->assertJsonPath('title', 'Buy milk')
            ->assertJsonPath('workflowStatus', 'needs-action');
    }

    public function test_create_task(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', $this->sampleTaskCreatePayload());

        $response->assertCreated()
            ->assertJsonPath('@type', 'Task')
            ->assertJsonPath('taskListId', InboxTaskListProvisioner::URI)
            ->assertJsonPath('title', 'New Task')
            ->assertJsonPath('due', '2026-06-15T09:00:00');

        $taskId = (string) $response->json('id');
        $this->assertNotSame('', $taskId);

        $list = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI);
        $list->assertOk();
        $this->assertContains($taskId, array_column($list->json('list'), 'id'));
    }

    public function test_create_task_with_priority_persists_ical_priority(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', [
                ...$this->sampleTaskCreatePayload(),
                'priority' => 1,
            ]);

        $response->assertCreated()
            ->assertJsonPath('priority', 1);

        $taskId = (string) $response->json('id');

        $show = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId);
        $show->assertOk()->assertJsonPath('priority', 1);

        $stored = $this->findBobTaskObject($taskId);
        $this->assertNotNull($stored);
        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('PRIORITY:1', $ics);
    }

    public function test_read_task_with_ical_priority_returns_same_value(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WeGotWorkspace//Tasks Test//EN\r\nBEGIN:VTODO\r\nUID:urn:uuid:prio-high\r\nSUMMARY:High priority task\r\nPRIORITY:1\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $taskId = $this->seedTaskViaPdo('bob', 'high-priority.ics', $ics);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId)
            ->assertOk()
            ->assertJsonPath('priority', 1);
    }

    public function test_update_task(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));
        $url = '/api/v1/tasks/items/'.$taskId;

        $response = $this->withBearer($this->userBearerToken())
            ->putJson($url, [
                'title' => 'Buy oat milk',
                'workflowStatus' => 'completed',
                'progress' => 100,
            ], $this->withIfMatch($this->fetchEtagFromGet($url)));

        $response->assertOk()
            ->assertJsonPath('id', $taskId)
            ->assertJsonPath('title', 'Buy oat milk')
            ->assertJsonPath('workflowStatus', 'completed')
            ->assertJsonPath('progress', 100);
    }

    public function test_update_with_another_task_list_moves_the_task(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));
        $url = '/api/v1/tasks/items/'.$taskId;
        $workId = $this->createTaskList('Work');

        $response = $this->withBearer($this->userBearerToken())
            ->putJson($url, [
                'taskListIds' => [$workId => true],
                'title' => 'Buy oat milk',
            ], $this->withIfMatch($this->fetchEtagFromGet($url)));

        $response->assertOk()
            ->assertJsonPath('id', $taskId)
            ->assertJsonPath('taskListId', $workId)
            ->assertJsonPath('title', 'Buy oat milk');
        $this->assertSame([], $this->taskIdsIn(InboxTaskListProvisioner::URI));
        $this->assertSame([$taskId], $this->taskIdsIn($workId));
        $this->withBearer($this->userBearerToken())
            ->getJson($url)
            ->assertOk()
            ->assertJsonPath('taskListId', $workId);
    }

    public function test_move_answers_a_new_etag_for_the_next_write(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));
        $url = '/api/v1/tasks/items/'.$taskId;
        $workId = $this->createTaskList('Work');

        $moved = $this->withBearer($this->userBearerToken())
            ->putJson($url, ['taskListIds' => [$workId => true], 'title' => 'Buy milk'], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertOk();

        $this->withBearer($this->userBearerToken())
            ->patchJson($url, ['title' => 'Buy oat milk'], $this->withIfMatch((string) $moved->json('etag')))
            ->assertOk()
            ->assertJsonPath('taskListId', $workId)
            ->assertJsonPath('title', 'Buy oat milk');
    }

    public function test_move_to_an_unknown_task_list_is_not_found_and_keeps_the_task(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));
        $url = '/api/v1/tasks/items/'.$taskId;

        $this->withBearer($this->userBearerToken())
            ->putJson($url, ['taskListIds' => ['no-such-list' => true], 'title' => 'Buy milk'], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertNotFound();

        $this->assertSame([$taskId], $this->taskIdsIn(InboxTaskListProvisioner::URI));
    }

    public function test_move_of_a_task_that_shares_its_file_is_refused(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n"
            ."BEGIN:VTODO\r\nUID:first\r\nSUMMARY:First\r\nEND:VTODO\r\n"
            ."BEGIN:VTODO\r\nUID:second\r\nSUMMARY:Second\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $this->seedTaskViaPdo('bob', 'pair.ics', $ics);
        $taskId = 'pair#first';
        $url = '/api/v1/tasks/items/'.rawurlencode($taskId);
        $workId = $this->createTaskList('Work');

        $this->withBearer($this->userBearerToken())
            ->putJson($url, ['taskListIds' => [$workId => true], 'title' => 'First'], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertStatus(409);

        $this->assertSame([], $this->taskIdsIn($workId));
    }

    public function test_patch_task(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));
        $url = '/api/v1/tasks/items/'.$taskId;

        $response = $this->withBearer($this->userBearerToken())
            ->patchJson($url, [
                'workflowStatus' => 'in-process',
                'progress' => 25,
            ], $this->withIfMatch($this->fetchEtagFromGet($url)));

        $response->assertOk()
            ->assertJsonPath('title', 'Buy milk')
            ->assertJsonPath('workflowStatus', 'in-process')
            ->assertJsonPath('progress', 25);
    }

    public function test_delete_task(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'buy-milk.ics', $this->sampleTodoIcs('Buy milk'));
        $url = '/api/v1/tasks/items/'.$taskId;

        $this->withBearer($this->userBearerToken())
            ->deleteJson($url, [], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId)
            ->assertNotFound();
    }

    public function test_user_cannot_read_other_users_task(): void
    {
        $taskId = $this->seedTaskViaPdo('carol', 'carol-task.ics', $this->sampleTodoIcs('Carol task'));

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId)
            ->assertNotFound();
    }

    public function test_create_rejects_server_owned_fields(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', [
                'taskListIds' => [InboxTaskListProvisioner::URI => true],
                'title' => 'Rejected',
                'id' => 'client-id',
            ])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
    }

    public function test_create_task_with_recurrence_persists_rrule(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', [
                'taskListIds' => [InboxTaskListProvisioner::URI => true],
                'title' => 'Weekly review',
                'due' => '2026-06-02T10:00:00',
                'recurrenceRules' => [
                    [
                        '@type' => 'RecurrenceRule',
                        'frequency' => 'weekly',
                        'byDay' => ['MO'],
                    ],
                ],
            ]);

        $response->assertCreated()
            ->assertJsonCount(1, 'recurrenceRules')
            ->assertJsonPath('recurrenceRules.0.frequency', 'weekly')
            ->assertJsonPath('recurrenceRules.0.byDay.0', 'MO');
    }

    private function findBobTaskObject(string $taskId): ?CalendarObject
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

    private function createTaskList(string $name): string
    {
        return (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/tasklists', ['name' => $name])
            ->assertCreated()
            ->json('id');
    }

    /** @return list<string> */
    private function taskIdsIn(string $taskListId): array
    {
        $list = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items?taskListId='.rawurlencode($taskListId))
            ->assertOk()
            ->json('list');

        return array_values(array_map(static fn (array $task): string => (string) $task['id'], $list));
    }
}
