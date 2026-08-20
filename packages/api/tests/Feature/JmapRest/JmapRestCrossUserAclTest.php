<?php

declare(strict_types=1);

namespace Tests\Feature\JmapRest;

use App\Services\Tasks\InboxTaskListProvisioner;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class JmapRestCrossUserAclTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedDefaultTaskListFor('bob');
        $this->seedDefaultTaskListFor('carol');
    }

    public function test_guest_cannot_access_jmap_rest_resources(): void
    {
        $this->getJson('/api/v1/tasks/items/demo-task')->assertUnauthorized();
    }

    public function test_user_cannot_read_other_users_task(): void
    {
        $taskId = $this->seedTaskViaPdo('carol', 'carol-task-read.ics', $this->sampleTodoIcs('Carol Task'));

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId)
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_update_other_users_task(): void
    {
        $taskId = $this->seedTaskViaPdo('carol', 'carol-task-update.ics', $this->sampleTodoIcs('Carol Task Update'));

        $this->withBearer($this->userBearerToken())
            ->putJson('/api/v1/tasks/items/'.$taskId, $this->sampleTaskCreatePayload())
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');

        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/tasks/items/'.$taskId, ['title' => 'Hijacked'])
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_delete_other_users_task(): void
    {
        $taskId = $this->seedTaskViaPdo('carol', 'carol-task-delete.ics', $this->sampleTodoIcs('Carol Task Delete'));

        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/tasks/items/'.$taskId)
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_list_other_users_tasks(): void
    {
        $this->seedTaskViaPdo('carol', 'carol-list-task.ics', $this->sampleTodoIcs('Carol List Task'));

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)
            ->assertOk()
            ->assertJsonPath('list', []);
    }
}
