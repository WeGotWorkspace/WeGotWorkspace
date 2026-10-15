<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The collab mailbox rules that Docs already has, repeated for a note room.
 * A read-only participant can read the mailbox and cannot publish a Yjs update.
 */
final class CollabNoteRoomMailboxTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $noteUid = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();

        $provisioner = app(UserCalendarCollectionsProvisioner::class);
        $provisioner->ensureForPrincipal('principals/bob');
        $provisioner->ensureForPrincipal('principals/carol');

        $notebookId = (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Mailbox'])
            ->assertCreated()
            ->json('id');
        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/notes/notebooks/'.$notebookId, [
                'shareWith' => ['carol' => ['mayReadItems' => true]],
            ])
            ->assertOk();
        $this->noteUid = (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/notes/items', [
                'notebookId' => $notebookId,
                'title' => 'Shared note',
                'body' => 'hello',
            ])
            ->assertCreated()
            ->json('id');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_a_read_only_participant_can_read_the_mailbox_but_cannot_publish_yjs(): void
    {
        $bob = $this->join($this->userBearerToken(), 'Bob');
        $carol = $this->join($this->carolBearerToken(), 'Carol');

        $this->send($this->userBearerToken(), $bob, $carol, 'yjs', $this->payload(1))
            ->assertOk();

        $messages = $this->poll($this->carolBearerToken(), $carol);
        $this->assertCount(1, $messages);
        $this->assertSame('yjs', $messages[0]['type']);
        $this->assertSame($bob, $messages[0]['from']);

        $this->send($this->carolBearerToken(), $carol, $bob, 'yjs', $this->payload(2))
            ->assertStatus(403)
            ->assertJson(['error' => 'forbidden']);

        $this->assertSame([], $this->poll($this->userBearerToken(), $bob));
    }

    public function test_a_read_only_participant_may_ask_for_a_state_vector(): void
    {
        $bob = $this->join($this->userBearerToken(), 'Bob');
        $carol = $this->join($this->carolBearerToken(), 'Carol');

        $this->send($this->carolBearerToken(), $carol, $bob, 'yjs-sv', $this->payload(1))
            ->assertOk();

        $this->assertSame('yjs-sv', $this->poll($this->userBearerToken(), $bob)[0]['type']);
    }

    private function roomId(): string
    {
        return RoomTestHelper::fileRoomId($this->noteUid);
    }

    private function join(string $token, string $name): string
    {
        return (string) $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$this->roomId().'/participants', ['name' => $name])
            ->assertOk()
            ->json('peerId');
    }

    /**
     * @param  array{u: string, n: int}  $payload
     */
    private function send(string $token, string $from, string $to, string $type, array $payload): TestResponse
    {
        return $this->withBearer($token)->postJson('/api/v1/rooms/'.$this->roomId().'/events', [
            'peerId' => $from,
            'to' => $to,
            'type' => $type,
            'payload' => $payload,
        ]);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function poll(string $token, string $peerId): array
    {
        $messages = $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.$this->roomId().'/events?peerId='.$peerId.'&since=0')
            ->assertOk()
            ->json('messages');
        $this->assertIsArray($messages);

        return $messages;
    }

    /**
     * @return array{u: string, n: int}
     */
    private function payload(int $seq): array
    {
        return ['u' => 'AQID', 'n' => $seq];
    }
}
