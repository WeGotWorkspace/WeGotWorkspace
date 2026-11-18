<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Services\Tasks\InboxTaskListProvisioner;
use App\Support\WgwSettings;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class TasksAccessControlTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    public function test_guest_cannot_access_tasks_endpoints(): void
    {
        $this->getJson('/api/v1/tasks/capabilities')->assertUnauthorized();
        $this->getJson('/api/v1/tasks/tasklists')->assertUnauthorized();
        $this->getJson('/api/v1/tasks/tasklists/changes')->assertUnauthorized();
        $this->getJson('/api/v1/tasks/tasklists/'.InboxTaskListProvisioner::URI)->assertUnauthorized();
        $this->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)->assertUnauthorized();
        $this->postJson('/api/v1/tasks/items/query', ['filter' => ['inTaskList' => InboxTaskListProvisioner::URI]])->assertUnauthorized();
        $this->postJson('/api/v1/tasks/items', [])->assertUnauthorized();
        $this->getJson('/api/v1/tasks/items/some-task/text')->assertUnauthorized();
        $this->get('/api/v1/tasks/items/some-task/text?format=yjs')->assertUnauthorized();
        $this->putJson('/api/v1/tasks/items/some-task/text', [])->assertUnauthorized();
    }

    public function test_capabilities_returns_jmap_subset(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/capabilities');

        $response->assertOk()
            ->assertJsonPath('enabled', true)
            ->assertJsonPath('jmapCapability', 'urn:ietf:params:jmap:tasks')
            ->assertJsonStructure(['supportedTaskProperties']);
    }

    public function test_authenticated_user_can_access_tasks_when_enabled(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->getJson('/api/v1/tasks/tasklists')->assertOk();
        $this->withBearer($token)->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)->assertOk();
    }

    public function test_tasks_disabled_returns_forbidden(): void
    {
        $this->setAppSetting(WgwSettings::TASKS_ENABLED, false);
        $token = $this->userBearerToken();

        $this->withBearer($token)->getJson('/api/v1/tasks/tasklists')->assertForbidden();
        $this->withBearer($token)->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)->assertForbidden();
        $this->withBearer($token)->postJson('/api/v1/tasks/items', [])->assertForbidden();
        $this->withBearer($token)->getJson('/api/v1/tasks/items/some-task/text')->assertForbidden();
        $this->withBearer($token)->get('/api/v1/tasks/items/some-task/text?format=yjs')->assertForbidden();
        $this->withBearer($token)->putJson('/api/v1/tasks/items/some-task/text', [])->assertForbidden();
    }
}
