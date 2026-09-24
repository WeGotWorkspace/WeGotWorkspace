<?php

declare(strict_types=1);

namespace Tests\Feature\JmapRest;

use App\Services\Tasks\InboxTaskListProvisioner;
use App\Services\VObject\VObjectPayloadGuard;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class JmapRestPayloadBoundsTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedDefaultTaskListFor('bob');
    }

    public function test_oversized_stored_task_read_returns_payload_too_large(): void
    {
        $padding = str_repeat('x', VObjectPayloadGuard::MAX_ICS_BYTES);
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:test\r\nSUMMARY:Huge\r\nDESCRIPTION:{$padding}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $taskId = $this->seedTaskViaPdo('bob', 'huge-task.ics', $ics);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId)
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    }

    public function test_oversized_task_create_returns_payload_too_large(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/items', [
                'taskListIds' => [InboxTaskListProvisioner::URI => true],
                'title' => 'Huge',
                'description' => str_repeat('x', VObjectPayloadGuard::MAX_ICS_BYTES),
            ])
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    }

    public function test_oversized_task_put_returns_payload_too_large(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'put-me.ics', $this->sampleTodoIcs('Before'));
        $url = '/api/v1/tasks/items/'.$taskId;

        $this->withBearer($this->userBearerToken())
            ->putJson($url, [
                'taskListIds' => [InboxTaskListProvisioner::URI => true],
                'title' => 'After',
                'description' => str_repeat('x', VObjectPayloadGuard::MAX_ICS_BYTES),
            ], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    }

    public function test_oversized_task_patch_returns_payload_too_large(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'patch-me.ics', $this->sampleTodoIcs('Before'));
        $url = '/api/v1/tasks/items/'.$taskId;

        $this->withBearer($this->userBearerToken())
            ->patchJson($url, [
                'description' => str_repeat('x', VObjectPayloadGuard::MAX_ICS_BYTES),
            ], $this->withIfMatch($this->fetchEtagFromGet($url)))
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    }

    public function test_task_list_omits_over_cap_task_and_stays_200(): void
    {
        $normalId = $this->seedTaskViaPdo('bob', 'normal-task.ics', $this->sampleTodoIcs('Normal'));

        $padding = str_repeat('x', VObjectPayloadGuard::MAX_ICS_BYTES);
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:huge-list\r\nSUMMARY:Huge\r\nDESCRIPTION:{$padding}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $overCapId = $this->seedTaskViaPdo('bob', 'huge-list.ics', $ics);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)
            ->assertOk();

        $ids = array_column($response->json('list'), 'id');
        $this->assertContains($normalId, $ids);
        $this->assertNotContains($overCapId, $ids);
    }
}
