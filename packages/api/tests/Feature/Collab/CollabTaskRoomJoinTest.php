<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\CalendarObject;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Collab\CollabJoinAuthorizer;
use App\Services\Collab\CollabRoomPolicy;
use App\Services\Tasks\TaskTextCollaboration;
use Illuminate\Support\Facades\DB;
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

    public function test_a_read_share_peer_cannot_send_yjs_into_the_task_room(): void
    {
        $listId = $this->sharedList('Read', ['mayReadItems' => true]);
        $this->seedTaskViaPdo('bob', 'read.ics', $this->sampleTodoIcs('Read', 'read-uid'), $listId);
        $room = $this->roomFor('read.ics', 'read-uid');
        $bob = $this->joinPeer('bob', $room);
        $carol = $this->joinPeer('carol', $room);

        $this->sendInRoom('carol', $room, $carol, $bob, 'yjs')->assertForbidden();
        $this->sendInRoom('bob', $room, $bob, $carol, 'yjs')->assertOk();
    }

    public function test_a_revoked_share_ends_the_task_room(): void
    {
        $listId = $this->sharedList('Revoked', ['mayReadItems' => true]);
        $this->seedTaskViaPdo('bob', 'revoked.ics', $this->sampleTodoIcs('Revoked', 'revoked-uid'), $listId);
        $room = $this->roomFor('revoked.ics', 'revoked-uid');
        $bob = $this->joinPeer('bob', $room);
        $carol = $this->joinPeer('carol', $room);

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, ['shareWith' => ['carol' => null]])
            ->assertOk();

        $this->assertForbidden($this->pollRoom('carol', $room, $carol));
        $this->assertSame(0, $this->peerRows($room, $carol));
        $this->assertSame(1, $this->peerRows($room, $bob));
        $this->pollRoom('bob', $room, $bob)->assertOk();
    }

    public function test_leaving_the_team_ends_the_team_lists_task_room(): void
    {
        $team = $this->seedWgwGroup('principals/groups/crew', 'Crew');
        $carol = Principal::forUsername('carol');
        $this->assertNotNull($carol);
        $membership = $this->addPrincipalToGroup($team, $carol);
        $taskId = (string) $this->withBearer($this->issueBearerTokenFor('carol'))
            ->postJson('/api/v1/tasks/items', [
                'taskListIds' => [CalendarCollectionUris::groupTaskListApiId('crew') => true],
                'title' => 'Team task',
            ])
            ->assertCreated()
            ->json('id');
        $room = (string) $this->withBearer($this->issueBearerTokenFor('carol'))
            ->getJson('/api/v1/tasks/items/'.rawurlencode($taskId).'/text')
            ->assertOk()
            ->json('room');
        $peer = $this->joinPeer('carol', $room);

        GroupMember::query()->whereKey($membership->getKey())->delete();

        $this->assertForbidden($this->pollRoom('carol', $room, $peer));
        $this->assertSame(0, $this->peerRows($room, $peer));
    }

    public function test_moving_the_task_ends_its_old_room(): void
    {
        $room = $this->roomFor('room-task.ics', self::UID);
        $peer = $this->joinPeer('bob', $room);
        $workId = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Work'])
            ->assertCreated()
            ->json('id');
        $etag = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->getJson('/api/v1/tasks/items/room-task')
            ->assertOk()
            ->json('etag');
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->withHeader('If-Match', $etag)
            ->putJson('/api/v1/tasks/items/room-task', ['taskListIds' => [$workId => true], 'title' => 'Room task'])
            ->assertOk();
        $this->flushHeaders();

        $this->assertForbidden($this->pollRoom('bob', $room, $peer));
        $this->assertSame(0, $this->peerRows($room, $peer));
        $this->join('bob', $this->roomFor('room-task.ics', self::UID))->assertOk();
    }

    public function test_a_note_whose_uid_starts_with_task_fails_closed_even_for_its_owner(): void
    {
        $notebookId = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Notes'])
            ->assertCreated()
            ->json('id');
        $noteId = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/notes/items', ['notebookId' => $notebookId, 'title' => 'Looks like a task', 'body' => 'hello'])
            ->assertCreated()
            ->json('id');
        $note = CalendarObject::query()->where('uid', $noteId)->firstOrFail();
        $room = 'task:'.$note->calendarid.':'.$noteId;
        $note->forceFill([
            'uid' => $room,
            'calendardata' => str_replace('UID:'.$noteId, 'UID:'.$room, (string) $note->calendardata),
        ])->save();

        $this->assertForbidden($this->join('bob', $room));
    }

    public function test_a_second_vtodo_with_like_wildcards_in_its_uid_is_found_by_its_text(): void
    {
        $uid = 'odd_%uid';
        $this->seedTaskViaPdo('bob', 'pair.ics', $this->sampleTodoIcs('First', 'first-of-pair'));
        $object = CalendarObject::query()->where('uri', 'pair.ics')->firstOrFail();
        $second = "BEGIN:VTODO\r\nUID:{$uid}\r\nDTSTAMP:20261118T000000Z\r\nSUMMARY:Second\r\nEND:VTODO\r\n";
        $this->updateTaskViaPdo('bob', 'pair.ics', str_replace("END:VCALENDAR\r\n", $second."END:VCALENDAR\r\n", (string) $object->calendardata));

        $this->join('bob', TaskTextCollaboration::roomKey((int) $object->calendarid, $uid))->assertOk();
        $this->assertForbidden($this->join('bob', TaskTextCollaboration::roomKey((int) $object->calendarid, 'odd__uid')));
    }

    public function test_a_poll_resolves_the_task_once(): void
    {
        $room = $this->roomFor('room-task.ics', self::UID);
        $peer = $this->joinPeer('bob', $room);
        $loaded = 0;
        CalendarObject::retrieved(function () use (&$loaded): void {
            $loaded++;
        });

        $this->pollRoom('bob', $room, $peer)->assertOk();

        $this->assertSame(1, $loaded);
    }

    public function test_a_wildcard_room_parses_no_file_and_is_refused(): void
    {
        $calendarId = (int) CalendarObject::query()->where('uri', 'room-task.ics')->value('calendarid');
        foreach (range(1, 25) as $n) {
            $this->seedTaskViaPdo('bob', "bulk-{$n}.ics", $this->sampleTodoIcs("Bulk {$n}", "bulk-{$n}"));
        }
        $parsed = 0;
        CalendarObject::retrieved(function () use (&$parsed): void {
            $parsed++;
        });

        $this->assertForbidden($this->join('bob', 'task:'.$calendarId.':%'));
        $this->assertForbidden($this->join('bob', 'task:'.$calendarId.':_'));
        $this->assertSame(0, $parsed);
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

    private function joinPeer(string $username, string $room): string
    {
        return (string) $this->join($username, $room)->assertOk()->json('peerId');
    }

    private function pollRoom(string $username, string $room, string $peerId): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor($username))
            ->getJson('/api/v1/rooms/'.RoomTestHelper::fileRoomId($room).'/events?peerId='.$peerId.'&since=0');
    }

    private function sendInRoom(string $username, string $room, string $from, string $to, string $type): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor($username))
            ->postJson('/api/v1/rooms/'.RoomTestHelper::fileRoomId($room).'/events', [
                'peerId' => $from,
                'to' => $to,
                'type' => $type,
                'payload' => ['u' => 'AQID', 'n' => 1],
            ]);
    }

    private function peerRows(string $room, string $peerId): int
    {
        return DB::connection('wgw')->table('collab_peers')
            ->where('room', app(CollabRoomPolicy::class)->roomKey($room))
            ->where('peer_id', $peerId)
            ->count();
    }

    private function assertForbidden(TestResponse $response): void
    {
        $response->assertForbidden()->assertJsonPath('code', 'forbidden');
    }
}
