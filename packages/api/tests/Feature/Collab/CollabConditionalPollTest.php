<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use Illuminate\Support\Str;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Conditional "nothing new" contract on the collab events poll: with `?sig=` echoing
 * a previous `rosterSig` the endpoint answers 204 No Content when the roster is
 * unchanged and no messages newer than `since` are pending.
 */
final class CollabConditionalPollTest extends WgwDatabaseTestCase
{
    private const ROOM = '/users/alice/docs/cond-poll.md';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();

        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    public function test_poll_returns_roster_signature_and_204_on_matching_sig(): void
    {
        $token = $this->issueBearerTokenFor('alice');
        $roomId = $this->roomId();

        $join = $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', ['name' => 'Alice']);
        $join->assertOk();
        $peerId = (string) $join->json('peerId');

        $first = $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$peerId.'&since=0');
        $first->assertOk();
        $first->assertJsonStructure(['peers', 'messages', 'rosterSig']);
        $sig = (string) $first->json('rosterSig');
        $this->assertNotSame('', $sig);

        $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$peerId.'&since=0&sig='.urlencode($sig))
            ->assertNoContent();
    }

    public function test_message_after_since_bypasses_204_until_cursor_advances(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->grantDocShareToBob();

        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');
        $roomId = $this->roomId();

        $aliceJoin = $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', ['name' => 'Alice']);
        $aliceJoin->assertOk();
        $alicePeerId = (string) $aliceJoin->json('peerId');

        $bobJoin = $this->withBearer($bobToken)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', ['name' => 'Bob']);
        $bobJoin->assertOk();
        $bobPeerId = (string) $bobJoin->json('peerId');

        // Alice learns the two-peer roster signature.
        $rosterPoll = $this->withBearer($aliceToken)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$alicePeerId.'&since=0');
        $rosterPoll->assertOk();
        $sig = (string) $rosterPoll->json('rosterSig');

        $this->withBearer($bobToken)
            ->postJson('/api/v1/rooms/'.$roomId.'/events', [
                'peerId' => $bobPeerId,
                'to' => $alicePeerId,
                'type' => 'offer',
                'payload' => ['type' => 'offer', 'sdp' => 'v=0'],
            ])->assertOk();

        // Same sig, but a message newer than since=0 is pending: full payload.
        $withMessage = $this->withBearer($aliceToken)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$alicePeerId.'&since=0&sig='.urlencode($sig));
        $withMessage->assertOk();
        $messages = $withMessage->json('messages');
        $this->assertIsArray($messages);
        $this->assertCount(1, $messages);
        $messageId = (int) $messages[0]['id'];

        // Cursor advanced past the message, roster unchanged: 204.
        $this->withBearer($aliceToken)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$alicePeerId.'&since='.$messageId.'&sig='.urlencode($sig))
            ->assertNoContent();

        // Old cursor still sees the retained message (since-cursor mode keeps rows).
        $this->withBearer($aliceToken)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$alicePeerId.'&since=0&sig='.urlencode($sig))
            ->assertOk();
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
