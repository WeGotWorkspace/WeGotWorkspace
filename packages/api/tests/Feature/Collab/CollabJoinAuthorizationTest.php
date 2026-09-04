<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Tests\Support\DriveTestFixtures;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Collab signaling rooms carry Yjs document sync; joining one must require
 * access to the underlying document (drive path) or note (VJOURNAL UID).
 */
final class CollabJoinAuthorizationTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const DOC_PATH = '/users/bob/workspace/plan.md';

    private const GROUP_DOC_PATH = '/groups/team/minutes.md';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();

        $this->createDriveDirectory('/users/bob', 'workspace');
        $this->createDriveFile($this->userBearerToken(), '/users/bob/workspace', 'plan.md');

        $provisioner = app(UserCalendarCollectionsProvisioner::class);
        $provisioner->ensureForPrincipal('principals/bob');
        $provisioner->ensureForPrincipal('principals/carol');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_join_denied_for_other_users_private_doc_room_without_share_grant(): void
    {
        $this->joinRoom($this->carolBearerToken(), RoomTestHelper::fileRoomId(self::DOC_PATH), 'Carol')
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
    }

    public function test_join_denied_for_other_users_note_room_without_notebook_share(): void
    {
        $noteUid = $this->createNoteAsBob();

        $this->joinRoom($this->carolBearerToken(), RoomTestHelper::fileRoomId($noteUid), 'Carol')
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
    }

    public function test_join_denied_for_room_matching_neither_known_form(): void
    {
        // Normalizes to /docs/legacy-room.md, which is not under any drive root.
        $this->joinRoom($this->userBearerToken(), RoomTestHelper::fileRoomId('docs/legacy-room.md'), 'Bob')
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
    }

    public function test_join_allowed_for_own_home_path(): void
    {
        $this->joinRoom($this->userBearerToken(), RoomTestHelper::fileRoomId(self::DOC_PATH), 'Bob')
            ->assertOk()
            ->assertJsonStructure(['peerId', 'peers']);
    }

    public function test_join_allowed_for_group_member_on_group_path(): void
    {
        $this->joinRoom($this->issueBearerTokenFor('alice'), RoomTestHelper::fileRoomId(self::GROUP_DOC_PATH), 'Alice')
            ->assertOk();

        $this->joinRoom($this->carolBearerToken(), RoomTestHelper::fileRoomId(self::GROUP_DOC_PATH), 'Carol')
            ->assertForbidden();
    }

    /**
     * The docs app strips the leading slash from drive paths when it builds the
     * collab room (`groups/team/minutes.md`, not `/groups/team/minutes.md`).
     * Joins with that shape must resolve to the same drive document.
     */
    public function test_join_allowed_for_group_member_on_group_path_without_leading_slash(): void
    {
        $roomId = RoomTestHelper::fileRoomId(ltrim(self::GROUP_DOC_PATH, '/'));

        $this->joinRoom($this->issueBearerTokenFor('alice'), $roomId, 'Alice')
            ->assertOk()
            ->assertJsonStructure(['peerId', 'peers']);

        $this->joinRoom($this->carolBearerToken(), $roomId, 'Carol')
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
    }

    public function test_join_allowed_for_own_home_path_without_leading_slash(): void
    {
        $this->joinRoom($this->userBearerToken(), RoomTestHelper::fileRoomId(ltrim(self::DOC_PATH, '/')), 'Bob')
            ->assertOk()
            ->assertJsonStructure(['peerId', 'peers']);
    }

    public function test_join_denied_for_other_users_private_doc_room_without_leading_slash(): void
    {
        $this->joinRoom($this->carolBearerToken(), RoomTestHelper::fileRoomId(ltrim(self::DOC_PATH, '/')), 'Carol')
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
    }

    public function test_join_allowed_with_doc_share_grant(): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::DOC_PATH,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $this->joinRoom($this->carolBearerToken(), RoomTestHelper::fileRoomId(self::DOC_PATH), 'Carol')
            ->assertOk()
            ->assertJsonStructure(['peerId', 'peers']);
    }

    public function test_join_allowed_for_own_note(): void
    {
        $noteUid = $this->createNoteAsBob();

        $this->joinRoom($this->userBearerToken(), RoomTestHelper::fileRoomId($noteUid), 'Bob')
            ->assertOk()
            ->assertJsonStructure(['peerId', 'peers']);
    }

    public function test_join_allowed_for_note_in_notebook_shared_with_joiner(): void
    {
        $notebookId = (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Shared Collab'])
            ->assertCreated()
            ->json('id');
        $noteUid = $this->createNoteAsBob($notebookId);

        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/notes/notebooks/'.$notebookId, [
                'shareWith' => ['carol' => ['mayReadItems' => true]],
            ])
            ->assertOk();

        $this->joinRoom($this->carolBearerToken(), RoomTestHelper::fileRoomId($noteUid), 'Carol')
            ->assertOk()
            ->assertJsonStructure(['peerId', 'peers']);
    }

    private function createNoteAsBob(?string $notebookId = null): string
    {
        $notebookId ??= (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Private Collab'])
            ->assertCreated()
            ->json('id');

        return (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/notes/items', [
                'notebookId' => $notebookId,
                'title' => 'Collab note',
                'body' => 'hello',
            ])
            ->assertCreated()
            ->json('id');
    }

    private function joinRoom(string $token, string $roomId, string $name)
    {
        return $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', ['name' => $name]);
    }
}
