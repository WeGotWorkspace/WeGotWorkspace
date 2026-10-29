<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\CollabPeer;
use App\Services\Settings\SettingKeys;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Document rooms follow the caller's current read access on every request,
 * relay included, and every answer about a room the caller may not read is
 * the same whatever peer id is asked for. The room id itself is only handed
 * out to a caller who may read the document.
 */
final class CollabRoomAccessTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const DOC_PATH = '/users/bob/workspace/plan.md';

    private string $shareId = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveDirectory('/users/bob', 'workspace');
        $this->createDriveFile($this->userBearerToken(), '/users/bob/workspace', 'plan.md');
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.test:3478',
            SettingKeys::RTC_TURN_SECRET => 'north',
        ]);
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_a_revoked_share_ends_relay_access(): void
    {
        $this->share();
        $carolPeer = $this->join($this->carolBearerToken(), 'Carol');
        $this->relay($this->carolBearerToken(), $carolPeer)->assertOk();

        $this->revokeShare();

        $this->relay($this->carolBearerToken(), $carolPeer)
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);
        $this->assertFalse(CollabPeer::query()->where('owner_user', 'u:carol')->exists());
    }

    public function test_after_a_revoked_share_the_reader_may_still_leave_with_their_own_peer(): void
    {
        $this->share();
        $carolPeer = $this->join($this->carolBearerToken(), 'Carol');
        $bobPeer = $this->join($this->userBearerToken(), 'Bob');

        $this->revokeShare();

        $this->assertDenied($this->leave($this->carolBearerToken(), $bobPeer));
        $this->leave($this->carolBearerToken(), $carolPeer)->assertOk()->assertJson(['ok' => true]);
        $this->assertFalse(CollabPeer::query()->where('owner_user', 'u:carol')->exists());
        $this->assertTrue(CollabPeer::query()->where('peer_id', $bobPeer)->exists());
    }

    public function test_a_revoked_share_removes_every_peer_of_that_account(): void
    {
        $this->share();
        $laptop = $this->join($this->carolBearerToken(), 'Carol', str_repeat('11', 16));
        $this->join($this->carolBearerToken(), 'Carol', str_repeat('22', 16));
        $bobPeer = $this->join($this->userBearerToken(), 'Bob');

        $this->revokeShare();

        $this->poll($this->carolBearerToken(), $laptop)->assertForbidden();
        $roster = $this->poll($this->userBearerToken(), $bobPeer)->assertOk()->json('peers');
        $this->assertSame([], array_values(array_filter(
            $roster,
            static fn (array $peer): bool => ($peer['user'] ?? null) === 'carol',
        )));
    }

    public function test_a_caller_without_read_access_gets_the_same_answer_for_a_live_and_an_unknown_peer_id(): void
    {
        $livePeer = $this->join($this->userBearerToken(), 'Bob');
        $unknownPeer = str_repeat('0', 16);
        $carol = $this->carolBearerToken();

        foreach ([$livePeer, $unknownPeer] as $peerId) {
            $this->assertDenied($this->poll($carol, $peerId));
            $this->assertDenied($this->send($carol, $peerId, $livePeer));
            $this->assertDenied($this->relay($carol, $peerId));
            $this->assertDenied($this->leave($carol, $peerId));
        }

        $this->assertTrue(CollabPeer::query()->where('peer_id', $livePeer)->exists());
    }

    public function test_the_room_id_is_handed_to_the_owner(): void
    {
        $this->resolveRoom($this->userBearerToken(), self::DOC_PATH)
            ->assertOk()
            ->assertJson(['roomId' => RoomTestHelper::fileRoomId(self::DOC_PATH), 'path' => self::DOC_PATH]);
    }

    public function test_the_room_id_is_handed_to_a_reader_of_a_shared_document(): void
    {
        $this->share();

        $this->resolveRoom($this->carolBearerToken(), self::DOC_PATH)
            ->assertOk()
            ->assertJsonPath('roomId', RoomTestHelper::fileRoomId(self::DOC_PATH));
    }

    public function test_the_room_id_is_not_found_for_a_document_the_caller_may_not_read(): void
    {
        $carol = $this->carolBearerToken();

        foreach ([self::DOC_PATH, '/users/bob/workspace/missing.md', '/users/carol/../bob/workspace/plan.md'] as $path) {
            $this->resolveRoom($carol, $path)
                ->assertNotFound()
                ->assertJsonPath('code', 'not_found')
                ->assertJsonMissingPath('roomId');
        }
    }

    public function test_the_room_id_is_not_found_once_the_share_is_revoked(): void
    {
        $this->share();
        $this->resolveRoom($this->carolBearerToken(), self::DOC_PATH)->assertOk();

        $this->revokeShare();

        $this->resolveRoom($this->carolBearerToken(), self::DOC_PATH)->assertNotFound();
    }

    private function assertDenied(TestResponse $response): void
    {
        $response->assertForbidden();
        $this->assertSame([
            'error' => 'forbidden',
            'message' => 'You do not have access to this document.',
        ], $response->json());
    }

    private function roomId(): string
    {
        return RoomTestHelper::fileRoomId(self::DOC_PATH);
    }

    private function join(string $token, string $name, ?string $browserId = null): string
    {
        $body = ['name' => $name];
        if ($browserId !== null) {
            $body['browserId'] = $browserId;
        }

        return (string) $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$this->roomId().'/participants', $body)
            ->assertOk()
            ->json('peerId');
    }

    private function poll(string $token, string $peerId): TestResponse
    {
        return $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.$this->roomId().'/events?peerId='.$peerId.'&since=0');
    }

    private function send(string $token, string $from, string $to): TestResponse
    {
        return $this->withBearer($token)->postJson('/api/v1/rooms/'.$this->roomId().'/events', [
            'peerId' => $from,
            'to' => $to,
            'type' => 'offer',
            'payload' => ['type' => 'offer', 'sdp' => 'v=0'],
        ]);
    }

    private function relay(string $token, string $peerId): TestResponse
    {
        return $this->withBearer($token)->postJson('/api/v1/rooms/'.$this->roomId().'/relay', [
            'peerId' => $peerId,
            'target' => '*',
            'reason' => 'precheck',
        ]);
    }

    private function leave(string $token, string $peerId): TestResponse
    {
        return $this->withBearer($token)
            ->deleteJson('/api/v1/rooms/'.$this->roomId().'/participants/'.$peerId);
    }

    private function resolveRoom(string $token, string $path): TestResponse
    {
        return $this->withBearer($token)->postJson('/api/v1/files/rooms?path='.rawurlencode($path));
    }

    private function share(): void
    {
        $created = $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::DOC_PATH,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ]);
        $created->assertOk();
        $this->shareId = (string) $created->json('data.id');
    }

    private function revokeShare(): void
    {
        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/files/shares/'.$this->shareId)
            ->assertOk();
    }
}
