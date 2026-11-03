<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Services\Tasks\InboxTaskListProvisioner;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class TasksTasksSyncTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    private const TEST_UID = 'urn:uuid:550e8400-e29b-41d4-a716-446655440099';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    public function test_task_list_changes_reports_created_list(): void
    {
        $initial = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists/changes')
            ->assertOk();

        $state = $initial->json('newState');
        $this->assertNotSame('', (string) $state);

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/tasklists', [
                'name' => 'Sync list',
                'id' => 'sync-list',
            ])
            ->assertCreated();

        $changes = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists/changes?since='.$state)
            ->assertOk();

        $changes->assertJsonPath('created.0', 'sync-list');
    }

    public function test_task_list_changes_report_both_lists_after_a_move(): void
    {
        $workId = (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Work'])
            ->assertCreated()
            ->json('id');
        $taskId = $this->seedTaskViaPdo('bob', 'move-me.ics', $this->sampleTodoIcs('Move me'));
        $url = '/api/v1/tasks/items/'.$taskId;
        $state = (string) $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists/changes')
            ->assertOk()
            ->json('newState');

        $this->withBearer($this->userBearerToken())
            ->putJson($url, ['taskListIds' => [$workId => true], 'title' => 'Move me'], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertOk();

        $updated = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists/changes?since='.$state)
            ->assertOk()
            ->json('updated');
        sort($updated);
        $expected = [InboxTaskListProvisioner::URI, $workId];
        sort($expected);
        $this->assertSame($expected, $updated);
    }

    public function test_query_by_uid_returns_matching_task_id(): void
    {
        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', array_merge(
                $this->sampleTaskCreatePayload(),
                [
                    'uid' => self::TEST_UID,
                    'title' => 'Query Target',
                ],
            ))
            ->assertCreated();

        $taskId = $create->json('id');

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items/query', [
                'filter' => [
                    'inTaskList' => InboxTaskListProvisioner::URI,
                    'uid' => self::TEST_UID,
                ],
            ])
            ->assertOk()
            ->assertJsonPath('ids.0', $taskId)
            ->assertJsonPath('total', 1);
    }

    public function test_query_limit_returns_subset_with_full_total(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', $this->sampleTaskCreatePayload())
            ->assertCreated();

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', array_merge(
                $this->sampleTaskCreatePayload(),
                ['title' => 'Second task'],
            ))
            ->assertCreated();

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items/query', [
                'filter' => [
                    'inTaskList' => InboxTaskListProvisioner::URI,
                ],
                'limit' => 1,
            ])
            ->assertOk()
            ->assertJsonCount(1, 'ids')
            ->assertJsonPath('total', 2);
    }

    public function test_task_list_changes_invalid_since_returns_bad_request(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists/changes?since=invalid-state-token')
            ->assertStatus(400)
            ->assertJsonPath('code', 'cannotCalculateChanges');
    }
}
