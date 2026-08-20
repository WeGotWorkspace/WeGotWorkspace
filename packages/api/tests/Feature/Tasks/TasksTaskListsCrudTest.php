<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\Principal;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Tasks\InboxTaskListProvisioner;
use App\Support\WgwSettings;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class TasksTaskListsCrudTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    public function test_create_update_and_delete_task_list(): void
    {
        $token = $this->userBearerToken();

        $created = $this->withBearer($token)
            ->postJson('/api/v1/tasks/tasklists', [
                'name' => 'Side project',
                'color' => '#336699',
            ])
            ->assertCreated()
            ->assertJsonPath('name', 'Side project')
            ->assertJsonPath('color', '#336699');

        $listId = (string) $created->json('id');
        $this->assertNotSame('', $listId);

        $this->withBearer($token)
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, [
                'name' => 'Renamed project',
                'color' => '#ff5500',
            ])
            ->assertOk()
            ->assertJsonPath('name', 'Renamed project')
            ->assertJsonPath('color', '#ff5500');

        $this->withBearer($token)
            ->deleteJson('/api/v1/tasks/tasklists/'.$listId)
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->getJson('/api/v1/tasks/tasklists/'.$listId)
            ->assertNotFound();
    }

    public function test_cannot_delete_inbox_task_list(): void
    {
        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/tasks/tasklists/'.InboxTaskListProvisioner::URI)
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }

    public function test_create_group_scoped_task_list(): void
    {
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);

        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/tasklists', [
                'name' => 'Roadmap',
                'color' => '#22c55e',
                'groupSlug' => 'team',
            ])
            ->assertCreated()
            ->assertJsonPath('name', 'Roadmap')
            ->assertJsonPath('color', '#22c55e')
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', 'team')
            ->assertJsonPath('id', 'roadmap');

        $listId = (string) $response->json('id');
        $this->assertNotSame('', $listId);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists/'.$listId)
            ->assertOk()
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', 'team');
    }

    public function test_calendars_list_excludes_vtodo_only_inbox(): void
    {
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);

        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ],
        ])->assertOk();

        $ids = array_column($response->json('methodResponses.0.1.list'), 'id');
        $this->assertNotContains(InboxTaskListProvisioner::URI, $ids);
    }
}
