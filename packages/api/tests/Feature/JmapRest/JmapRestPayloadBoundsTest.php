<?php

declare(strict_types=1);

namespace Tests\Feature\JmapRest;

use App\Services\VObject\VObjectPayloadGuard;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class JmapRestPayloadBoundsTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $this->setUpTasksFixtures();
        $this->seedDefaultTaskListFor('bob');
    }

    public function test_oversized_contact_create_returns_payload_too_large(): void
    {
        $note = str_repeat('x', VObjectPayloadGuard::MAX_VCARD_BYTES);

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards', [
                'addressBookIds' => ['default' => true],
                'name' => ['full' => 'Oversized Contact'],
                'notes' => [
                    '550e8400-e29b-41d4-a716-446655440099' => ['note' => $note],
                ],
            ])
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    }

    public function test_oversized_stored_contact_read_returns_payload_too_large(): void
    {
        $padding = str_repeat('x', VObjectPayloadGuard::MAX_VCARD_BYTES);
        $vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Huge\r\nNOTE:{$padding}\r\nEND:VCARD\r\n";
        $cardId = $this->seedCardViaPdo('bob', 'huge-card.vcf', $vcard);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/contacts/cards/'.$cardId)
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
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
