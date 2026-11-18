<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\CalendarObject;
use App\Services\Collab\CollabJoinAuthorizer;
use App\Services\Tasks\TaskTextCollaboration;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\RoomTestHelper;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A task's live-text room `task:<calendarid>:<vtodo-uid>` (#2208) is joined
 * with read access to that task's list, never by the object URI a caller
 * could reuse in a list of their own.
 */
final class CollabTaskRoomJoinTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    private const UID = 'urn:uuid:9e3d2c1b-0a4f-4e5d-8c7b-6a5f4e3d2c1b';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedTaskViaPdo('bob', 'room-task.ics', $this->sampleTodoIcs('Room task', self::UID));
    }

    public function test_the_owner_joins_with_write_access(): void
    {
        $room = $this->roomFor('room-task.ics', self::UID);

        $this->join('bob', $room)->assertOk()->assertJsonStructure(['peerId', 'peers']);
        $this->assertSame('write', $this->accessFor('bob', $room));
    }

    public function test_someone_without_the_list_is_refused(): void
    {
        $this->assertForbidden($this->join('carol', $this->roomFor('room-task.ics', self::UID)));
    }

    public function test_a_uid_with_a_slash_and_colons_is_a_task_room_not_a_drive_path(): void
    {
        $uid = 'native/uid:with:colons';
        $this->seedTaskViaPdo('bob', 'native.ics', $this->sampleTodoIcs('Native', $uid));

        $this->join('bob', $this->roomFor('native.ics', $uid))->assertOk();
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function malformedRooms(): iterable
    {
        yield 'prefix only' => ['task:'];
        yield 'no calendar id' => ['task::'.self::UID];
        yield 'calendar id not decimal' => ['task:abc:'.self::UID];
        yield 'empty uid' => ['task:1:'];
        yield 'no uid separator' => ['task:1'];
    }

    #[DataProvider('malformedRooms')]
    public function test_a_malformed_task_room_is_refused(string $room): void
    {
        $this->assertForbidden($this->join('bob', $room));
    }

    public function test_reusing_a_task_uri_and_uid_in_ones_own_list_does_not_reach_the_other_room(): void
    {
        $this->seedTaskViaPdo('carol', 'room-task.ics', $this->sampleTodoIcs('Copy', self::UID));
        $bobsRoom = $this->roomFor('room-task.ics', self::UID, 'bob');
        $carolsRoom = $this->roomFor('room-task.ics', self::UID, 'carol');

        $this->assertNotSame($bobsRoom, $carolsRoom);
        $this->assertForbidden($this->join('carol', $bobsRoom));
        $this->join('carol', $carolsRoom)->assertOk();
    }

    public function test_a_read_share_joins_read_only_and_a_write_share_writes(): void
    {
        $readList = $this->sharedList('Read', ['mayReadItems' => true]);
        $this->seedTaskViaPdo('bob', 'read.ics', $this->sampleTodoIcs('Read', 'read-uid'), $readList);
        $writeList = $this->sharedList('Write', ['mayWriteAll' => true]);
        $this->seedTaskViaPdo('bob', 'write.ics', $this->sampleTodoIcs('Write', 'write-uid'), $writeList);

        $readRoom = $this->roomFor('read.ics', 'read-uid');
        $this->join('carol', $readRoom)->assertOk();
        $this->assertSame('read', $this->accessFor('carol', $readRoom));
        $this->assertSame('write', $this->accessFor('carol', $this->roomFor('write.ics', 'write-uid')));
    }

    public function test_a_dismissed_share_is_refused(): void
    {
        $listId = $this->sharedList('Dismissed', ['mayReadItems' => true]);
        $this->seedTaskViaPdo('bob', 'dismissed.ics', $this->sampleTodoIcs('Dismissed', 'dismissed-uid'), $listId);
        $room = $this->roomFor('dismissed.ics', 'dismissed-uid');
        $this->join('carol', $room)->assertOk();

        $carolsId = collect($this->withBearer($this->issueBearerTokenFor('carol'))->getJson('/api/v1/tasks/tasklists')->json('list'))
            ->firstWhere('name', 'Dismissed')['id'] ?? null;
        $this->assertIsString($carolsId);
        $this->withBearer($this->issueBearerTokenFor('carol'))->deleteJson('/api/v1/tasks/tasklists/'.$carolsId)->assertOk();

        $this->assertForbidden($this->join('carol', $room));
    }

    private function roomFor(string $objectUri, string $uid, string $owner = 'bob'): string
    {
        $object = CalendarObject::query()
            ->where('uri', $objectUri)
            ->whereHas('calendar.instances', fn ($query) => $query->where('principaluri', 'principals/'.$owner))
            ->firstOrFail();

        return TaskTextCollaboration::roomKey((int) $object->calendarid, $uid);
    }

    /**
     * @param  array<string, bool>  $rights
     */
    private function sharedList(string $name, array $rights): string
    {
        $this->seedSharedTeamForEveryone();
        $listId = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/tasks/tasklists', ['name' => $name])
            ->assertCreated()
            ->json('id');
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, ['shareWith' => ['carol' => $rights]])
            ->assertOk();

        return $listId;
    }

    private function accessFor(string $username, string $room): string
    {
        return app(CollabJoinAuthorizer::class)->accessFor($room, ['username' => $username, 'role' => 'user']);
    }

    private function join(string $username, string $room): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor($username))
            ->postJson('/api/v1/rooms/'.RoomTestHelper::fileRoomId($room).'/participants', ['name' => ucfirst($username)]);
    }

    private function assertForbidden(TestResponse $response): void
    {
        $response->assertForbidden()->assertJsonPath('code', 'forbidden');
    }
}
