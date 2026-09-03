<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Str;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

final class CollabEndpointsTest extends WgwDatabaseTestCase
{
    private const ROOM = '/users/alice/docs/test-together.md';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();

        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    public function test_join_requires_auth(): void
    {
        $this->postJson('/api/v1/rooms/'.$this->roomId().'/participants', [
            'name' => 'Alice',
        ])->assertUnauthorized();
    }

    public function test_rtc_settings_returns_meet_ice_values_for_authenticated_user(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_STUN_URL => 'stun.example.test:3478,stuns:stun2.example.test:5349',
            SettingKeys::RTC_TURN_URL => 'turn.example.test:3478?transport=udp',
            SettingKeys::RTC_TURN_USERNAME => 'rtc-user',
            SettingKeys::RTC_TURN_CREDENTIAL => 'rtc-secret',
        ]);

        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.$this->roomId().'/configuration')
            ->assertOk()
            ->assertJsonPath('rtc.stunUrls', 'stun:stun.example.test:3478, stuns:stun2.example.test:5349')
            ->assertJsonPath('rtc.turnUrls', 'turn:turn.example.test:3478?transport=udp')
            ->assertJsonPath('rtc.turnUsername', 'rtc-user')
            ->assertJsonPath('rtc.turnPassword', 'rtc-secret')
            ->assertJsonMissingPath('meet.forceRelay');
    }

    public function test_two_users_exchange_signaling_messages(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');
        // Collab join requires document access: grant bob a share on alice's doc.
        $this->grantDocShareToBob();

        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');
        $roomId = $this->roomId();

        $aliceJoin = $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', [
                'name' => 'Alice',
            ]);
        $aliceJoin->assertOk();
        $aliceJoin->assertJsonStructure(['peerId', 'peers']);
        $alicePeerId = (string) $aliceJoin->json('peerId');
        $this->assertMatchesRegularExpression('/^[a-f0-9]{16}$/', $alicePeerId);

        $bobJoin = $this->withBearer($bobToken)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', [
                'name' => 'Bob',
            ]);
        $bobJoin->assertOk();
        $bobPeerId = (string) $bobJoin->json('peerId');
        $bobJoin->assertJsonPath('peers.0.id', $alicePeerId);

        $offerPayload = ['type' => 'offer', 'sdp' => 'v=0'];
        $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.$roomId.'/events', [
                'peerId' => $alicePeerId,
                'to' => $bobPeerId,
                'type' => 'offer',
                'payload' => $offerPayload,
            ])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $poll = $this->withBearer($bobToken)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$bobPeerId.'&since=0');
        $poll->assertOk();
        $poll->assertJsonPath('peers.0.id', $alicePeerId);
        $messages = $poll->json('messages');
        $this->assertIsArray($messages);
        $this->assertCount(1, $messages);
        $this->assertSame('offer', $messages[0]['type']);
        $this->assertSame($alicePeerId, $messages[0]['from']);
        $this->assertSame($offerPayload, $messages[0]['payload']);

        $this->withBearer($aliceToken)
            ->deleteJson('/api/v1/rooms/'.$roomId.'/participants/'.$alicePeerId)
            ->assertOk()
            ->assertJson(['ok' => true]);

        $afterLeave = $this->withBearer($bobToken)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$bobPeerId.'&since=0');
        $afterLeave->assertOk();
        $afterLeave->assertJsonPath('peers', []);
    }

    public function test_same_user_rejoin_replaces_the_previous_peer(): void
    {
        $token = $this->issueBearerTokenFor('alice');
        $roomId = $this->roomId();

        $first = $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', [
                'name' => 'Alice',
            ]);
        $first->assertOk();
        $firstPeerId = (string) $first->json('peerId');

        $second = $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', [
                'name' => 'Alice',
            ]);
        $second->assertOk();
        $secondPeerId = (string) $second->json('peerId');
        $this->assertNotSame($firstPeerId, $secondPeerId);
        $this->assertSame([], $second->json('peers'));

        $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$firstPeerId.'&since=0')
            ->assertNotFound()
            ->assertJsonPath('error', 'unknown_peer');
    }

    public function test_slashed_and_unslashed_file_room_ids_share_one_roster(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->grantDocShareToBob();

        $legacySlashed = 'f_'.rtrim(strtr(base64_encode(self::ROOM), '+/', '-_'), '=');
        $canonical = RoomTestHelper::fileRoomId(ltrim(self::ROOM, '/'));
        $this->assertNotSame($legacySlashed, $canonical);

        $alicePeerId = (string) $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/rooms/'.$legacySlashed.'/participants', ['name' => 'Alice'])
            ->assertOk()
            ->json('peerId');

        $bobJoin = $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/rooms/'.$canonical.'/participants', ['name' => 'Bob']);
        $bobJoin->assertOk();
        $this->assertSame($alicePeerId, $bobJoin->json('peers.0.id'));
    }

    private function roomId(): string
    {
        return RoomTestHelper::fileRoomId(self::ROOM);
    }

    private function grantDocShareToBob(): void
    {
        $share = new DriveShare;
        $share->id = (string) Str::uuid();
        $share->path = self::ROOM;
        $share->owner_username = 'alice';
        $share->kind = 'member';
        $share->default_access = 'edit';
        $share->save();

        $grant = new DriveShareGrant;
        $grant->id = (string) Str::uuid();
        $grant->share_id = $share->id;
        $grant->grantee_type = 'user';
        $grant->grantee_user = 'bob';
        $grant->access = 'edit';
        $grant->status = 'active';
        $grant->save();
    }
}
