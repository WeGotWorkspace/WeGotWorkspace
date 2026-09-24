<?php

declare(strict_types=1);

namespace Tests\Feature\Principal;

use App\Models\Principal;
use App\Models\PrincipalPeer;
use App\Services\Settings\SettingKeys;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Principal presence rooms (`p_` room kind): auth-required join, group-membership
 * authorization, offer/answer/ice relay on the since cursor, and the conditional
 * 204 poll fast path.
 */
final class PrincipalRoomTest extends WgwDatabaseTestCase
{
    private const WORKSPACE_ROOM_ID = 'p_workspace';

    private const GROUP_ROOM_ID = 'p_groups.design';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();

        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
    }

    public function test_unauthenticated_join_is_denied(): void
    {
        $this->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => 'Alice'])
            ->assertUnauthorized()
            ->assertJson(['error' => 'auth_required']);
    }

    public function test_any_authenticated_user_may_join_the_workspace_room(): void
    {
        $token = $this->issueBearerTokenFor('alice');

        $join = $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => 'Alice']);
        $join->assertOk();
        $join->assertJsonStructure(['peerId', 'peers']);

        $peerId = (string) $join->json('peerId');
        $this->assertMatchesRegularExpression('/^alice-[a-f0-9]{6}$/', $peerId);
    }

    public function test_join_defaults_display_name_to_username(): void
    {
        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');

        $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', [])
            ->assertOk();

        $bobJoin = $this->withBearer($bobToken)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => 'Bob']);
        $bobJoin->assertOk();
        $bobJoin->assertJsonPath('peers.0.name', 'alice');
    }

    public function test_roster_exposes_the_owner_username(): void
    {
        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');

        $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => 'Alice'])
            ->assertOk();

        $bobJoin = $this->withBearer($bobToken)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => 'Bob']);
        $bobJoin->assertOk();
        $bobJoin->assertJsonPath('peers.0.user', 'alice');
        $bobJoin->assertJsonPath('peers.0.name', 'Alice');
    }

    public function test_group_room_denies_non_members(): void
    {
        $this->seedDesignGroupWith('alice');

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/rooms/'.self::GROUP_ROOM_ID.'/participants', ['name' => 'Bob'])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_group_room_allows_members(): void
    {
        $this->seedDesignGroupWith('alice');

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/rooms/'.self::GROUP_ROOM_ID.'/participants', ['name' => 'Alice'])
            ->assertOk()
            ->assertJsonStructure(['peerId', 'peers']);
    }

    public function test_unknown_room_form_is_denied(): void
    {
        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/rooms/p_some-other-room/participants', ['name' => 'Alice'])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_offer_answer_ice_relay_with_since_cursor(): void
    {
        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');

        $alicePeerId = $this->joinWorkspace($aliceToken, 'Alice');
        $bobPeerId = $this->joinWorkspace($bobToken, 'Bob');

        $offerPayload = ['type' => 'offer', 'sdp' => 'v=0'];
        $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events', [
                'peerId' => $alicePeerId,
                'to' => $bobPeerId,
                'type' => 'offer',
                'payload' => $offerPayload,
            ])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $poll = $this->withBearer($bobToken)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$bobPeerId.'&since=0');
        $poll->assertOk();
        $poll->assertJsonPath('peers.0.id', $alicePeerId);
        $messages = $poll->json('messages');
        $this->assertIsArray($messages);
        $this->assertCount(1, $messages);
        $this->assertSame('offer', $messages[0]['type']);
        $this->assertSame($alicePeerId, $messages[0]['from']);
        $this->assertSame($offerPayload, $messages[0]['payload']);
        $offerId = (int) $messages[0]['id'];

        $this->withBearer($bobToken)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events', [
                'peerId' => $bobPeerId,
                'to' => $alicePeerId,
                'type' => 'answer',
                'payload' => ['type' => 'answer', 'sdp' => 'v=0'],
            ])->assertOk();

        $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events', [
                'peerId' => $alicePeerId,
                'to' => $bobPeerId,
                'type' => 'ice',
                'payload' => ['candidate' => 'candidate:1'],
            ])->assertOk();

        // Since-cursor semantics: bob's next poll from the offer id returns only the ice message.
        $second = $this->withBearer($bobToken)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$bobPeerId.'&since='.$offerId);
        $second->assertOk();
        $secondMessages = $second->json('messages');
        $this->assertCount(1, $secondMessages);
        $this->assertSame('ice', $secondMessages[0]['type']);
    }

    public function test_disallowed_send_type_is_rejected(): void
    {
        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');

        $alicePeerId = $this->joinWorkspace($aliceToken, 'Alice');
        $bobPeerId = $this->joinWorkspace($bobToken, 'Bob');

        $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events', [
                'peerId' => $alicePeerId,
                'to' => $bobPeerId,
                'type' => 'bye',
                'payload' => null,
            ])
            ->assertBadRequest()
            ->assertJson(['error' => 'bad_type']);
    }

    public function test_conditional_poll_answers_204_on_matching_sig(): void
    {
        $token = $this->issueBearerTokenFor('alice');
        $peerId = $this->joinWorkspace($token, 'Alice');

        $first = $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$peerId.'&since=0');
        $first->assertOk();
        $first->assertJsonStructure(['peers', 'messages', 'rosterSig']);
        $sig = (string) $first->json('rosterSig');
        $this->assertNotSame('', $sig);

        $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$peerId.'&since=0&sig='.urlencode($sig))
            ->assertNoContent();
    }

    public function test_pending_message_bypasses_the_204_fast_path(): void
    {
        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');

        $alicePeerId = $this->joinWorkspace($aliceToken, 'Alice');
        $bobPeerId = $this->joinWorkspace($bobToken, 'Bob');

        $rosterPoll = $this->withBearer($aliceToken)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$alicePeerId.'&since=0');
        $rosterPoll->assertOk();
        $sig = (string) $rosterPoll->json('rosterSig');

        $this->withBearer($aliceToken)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$alicePeerId.'&since=0&sig='.urlencode($sig))
            ->assertNoContent();

        $this->withBearer($bobToken)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events', [
                'peerId' => $bobPeerId,
                'to' => $alicePeerId,
                'type' => 'offer',
                'payload' => ['type' => 'offer', 'sdp' => 'v=0'],
            ])->assertOk();

        $withMessage = $this->withBearer($aliceToken)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$alicePeerId.'&since=0&sig='.urlencode($sig));
        $withMessage->assertOk();
        $this->assertCount(1, $withMessage->json('messages'));
    }

    public function test_poll_rejects_a_peer_owned_by_another_user(): void
    {
        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');

        $alicePeerId = $this->joinWorkspace($aliceToken, 'Alice');

        $this->withBearer($bobToken)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$alicePeerId.'&since=0')
            ->assertForbidden();
    }

    public function test_leave_removes_the_peer_from_the_roster(): void
    {
        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');

        $alicePeerId = $this->joinWorkspace($aliceToken, 'Alice');
        $bobPeerId = $this->joinWorkspace($bobToken, 'Bob');

        $this->withBearer($aliceToken)
            ->deleteJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants/'.$alicePeerId)
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->withBearer($bobToken)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$bobPeerId.'&since=0')
            ->assertOk()
            ->assertJsonPath('peers', []);
    }

    public function test_same_user_rejoin_within_grace_keeps_previous_peer_pollable(): void
    {
        $token = $this->issueBearerTokenFor('alice');

        $first = $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => 'Alice']);
        $first->assertOk();
        $firstPeerId = (string) $first->json('peerId');

        $second = $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => 'Alice']);
        $second->assertOk();
        $secondPeerId = (string) $second->json('peerId');
        $this->assertNotSame($firstPeerId, $secondPeerId);

        $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$firstPeerId.'&since=0')
            ->assertOk()
            ->assertJsonPath('peers.0.id', $secondPeerId);
    }

    public function test_same_user_rejoin_after_grace_evicts_previous_peer(): void
    {
        $token = $this->issueBearerTokenFor('alice');

        $first = $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => 'Alice']);
        $first->assertOk();
        $firstPeerId = (string) $first->json('peerId');

        PrincipalPeer::query()
            ->where('peer_id', $firstPeerId)
            ->update(['seen_at' => time() - 20]);

        $second = $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => 'Alice']);
        $second->assertOk();
        $secondPeerId = (string) $second->json('peerId');
        $this->assertNotSame($firstPeerId, $secondPeerId);
        $this->assertSame([], $second->json('peers'));

        $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/events?peerId='.$firstPeerId.'&since=0')
            ->assertNotFound()
            ->assertJsonPath('error', 'unknown_peer');
    }

    public function test_chat_endpoint_stays_meet_only(): void
    {
        $token = $this->issueBearerTokenFor('alice');
        $this->joinWorkspace($token, 'Alice');

        $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/messages', ['body' => 'hi'])
            ->assertStatus(405);
    }

    public function test_configuration_returns_rtc_settings(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_STUN_URL => 'stun.example.test:3478',
        ]);

        $this->getJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/configuration')
            ->assertOk()
            ->assertJsonPath('rtc.stunUrls', 'stun:stun.example.test:3478');
    }

    private function joinWorkspace(string $token, string $name): string
    {
        $join = $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.self::WORKSPACE_ROOM_ID.'/participants', ['name' => $name]);
        $join->assertOk();

        return (string) $join->json('peerId');
    }

    private function seedDesignGroupWith(string ...$usernames): void
    {
        $group = $this->seedWgwGroup('principals/groups/design', 'Design');
        foreach ($usernames as $username) {
            $principal = Principal::forUsername($username);
            $this->assertNotNull($principal);
            $this->addPrincipalToGroup($group, $principal);
        }
    }
}
