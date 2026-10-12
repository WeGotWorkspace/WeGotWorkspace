<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\CollabPeer;
use App\Models\RtcRelayEvent;
use App\Services\Settings\SettingKeys;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The collab roster carries the access level the server itself resolved at
 * join time. A peer never gets to claim its own rights, so the stored value is
 * the only one anybody downstream may trust.
 */
final class CollabRosterAccessTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const DOC_PATH = '/users/bob/workspace/plan.md';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveDirectory('/users/bob', 'workspace');
        $this->createDriveFile($this->userBearerToken(), '/users/bob/workspace', 'plan.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_the_owner_of_a_document_joins_with_write_access(): void
    {
        $this->join($this->userBearerToken(), 'Bob')->assertOk();

        $this->assertSame('write', $this->storedAccessFor('bob'));
    }

    public function test_a_view_share_joins_with_read_access(): void
    {
        $this->share('view');

        $this->join($this->carolBearerToken(), 'Carol')->assertOk();

        $this->assertSame('read', $this->storedAccessFor('carol'));
    }

    public function test_a_comment_share_joins_with_comment_access(): void
    {
        $this->share('comment');

        $this->join($this->carolBearerToken(), 'Carol')->assertOk();

        $this->assertSame('comment', $this->storedAccessFor('carol'));
    }

    public function test_an_edit_share_joins_with_write_access(): void
    {
        $this->share('edit');

        $this->join($this->carolBearerToken(), 'Carol')->assertOk();

        $this->assertSame('write', $this->storedAccessFor('carol'));
    }

    public function test_the_roster_reports_the_access_the_server_resolved(): void
    {
        $this->share('view');
        $this->join($this->carolBearerToken(), 'Carol')->assertOk();

        $peers = $this->join($this->userBearerToken(), 'Bob')->json('peers');
        $carol = collect($peers)->firstWhere('user', 'carol');

        $this->assertSame('read', $carol['access']);
    }

    public function test_join_records_capabilities_net_class_and_browser(): void
    {
        $browserId = str_repeat('a', 32);

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/rooms/'.$this->roomId().'/participants', [
                'name' => 'Bob',
                'browserId' => $browserId,
                'caps' => ['yjs-http', 'since-ack'],
                'net' => 'open',
            ])
            ->assertOk();

        $peer = CollabPeer::query()->where('owner_user', 'u:bob')->firstOrFail();
        $this->assertSame($browserId, $peer->browser_id);
        $this->assertSame('yjs-http,since-ack', $peer->caps);
        $this->assertSame('open', $peer->net);
    }

    public function test_the_relay_issues_credentials_and_hints_the_target_peer(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.test:3478',
            SettingKeys::RTC_TURN_SECRET => 'north',
        ]);
        $this->share('edit');
        $target = (string) $this->join($this->carolBearerToken(), 'Carol')->json('peerId');
        $self = (string) $this->join($this->userBearerToken(), 'Bob')->json('peerId');

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/rooms/'.$this->roomId().'/relay', [
                'peerId' => $self,
                'target' => $target,
                'reason' => 'failed',
            ])
            ->assertOk()
            ->assertJsonStructure(['turn' => ['urls', 'username', 'credential', 'ttl']]);

        $this->assertTrue(
            RtcRelayEvent::query()->where('channel', 'collab')->where('outcome', 'issued')->exists(),
        );
        $messages = $this->withBearer($this->carolBearerToken())
            ->getJson('/api/v1/rooms/'.$this->roomId().'/events?peerId='.$target)
            ->assertOk()
            ->json('messages');
        $this->assertSame('relay-hint', $messages[0]['type']);
    }

    public function test_the_relay_is_unavailable_without_a_secret(): void
    {
        $peerId = (string) $this->join($this->userBearerToken(), 'Bob')->json('peerId');

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/rooms/'.$this->roomId().'/relay', [
                'peerId' => $peerId,
                'target' => '*',
                'reason' => 'precheck',
            ])
            ->assertStatus(503)
            ->assertJson(['error' => 'relay_unavailable']);
    }

    private function roomId(): string
    {
        return RoomTestHelper::fileRoomId(self::DOC_PATH);
    }

    private function join(string $token, string $name): TestResponse
    {
        return $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$this->roomId().'/participants', ['name' => $name]);
    }

    private function share(string $access): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::DOC_PATH,
            'kind' => 'member',
            'defaultAccess' => $access,
            'shareWith' => ['carol' => ['access' => $access]],
        ])->assertOk();
    }

    private function storedAccessFor(string $username): string
    {
        return (string) CollabPeer::query()
            ->where('owner_user', 'u:'.$username)
            ->value('access');
    }
}
