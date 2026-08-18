<?php

declare(strict_types=1);

namespace Tests\Feature\JmapRest;

use App\Services\VObject\VObjectPayloadGuard;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class JmapRestPayloadBoundsTest extends WgwDatabaseTestCase
{
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
}
