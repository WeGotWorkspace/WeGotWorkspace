<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use App\Models\MeetReservation;
use App\Services\Auth\JwtTokenService;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A guest-role bearer (a public Drive link session, subject `share:<key>`) is
 * not an account. On Meet routes it is treated exactly like an anonymous
 * caller: refused where anonymous is refused, through the lobby where
 * anonymous goes through the lobby, and kept off the reservation routes.
 */
final class MeetLinkGuestBearerTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private const KNOCK_PREFIX = '__wgw_knock__:';

    private const RESERVED_CODE = 'h8y8-ewp6-al8n';

    private const OPEN_CODE = 'k3m4-n5p6-q7r8';

    private string $channelId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('carol', displayName: 'Carol');

        $this->channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Team', 'kind' => 'channel',
        ])->assertCreated()->json('id');
    }

    public function test_link_guest_is_refused_on_a_channel_room_like_an_anonymous_caller(): void
    {
        $this->asUser('alice')->postJson('/api/v1/rooms/'.$this->channelId.'/participants', [
            'peerId' => 'peer-alice',
            'name' => 'Alice',
        ])->assertOk();

        $this->linkGuestJoin($this->channelId, 'peer-guest', 'Visitor')
            ->assertForbidden()->assertJsonPath('error', 'forbidden');
        $this->linkGuestJoin($this->channelId, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertForbidden()->assertJsonPath('error', 'forbidden');
        $this->withBearer($this->linkGuestToken())
            ->getJson('/api/v1/rooms/'.$this->channelId.'/events?peerId=peer-guest')
            ->assertForbidden()->assertJsonPath('error', 'forbidden');
    }

    public function test_link_guest_does_not_see_the_status_of_a_guest_closed_room(): void
    {
        $this->asUser('alice')->postJson('/api/v1/meetings/rooms', [
            'room' => 'crew-standup-room',
            'ownerPrincipal' => 'u:alice',
        ])->assertCreated();

        $this->withBearer($this->linkGuestToken())
            ->getJson('/api/v1/meetings/rooms/crew-standup-room')
            ->assertNotFound()->assertJsonPath('error', 'not_found');
        $this->flushHeaders()
            ->getJson('/api/v1/meetings/rooms/crew-standup-room')
            ->assertNotFound();
        $this->asUser('carol')
            ->getJson('/api/v1/meetings/rooms/crew-standup-room')
            ->assertOk()->assertJsonPath('reserved', true);
    }

    public function test_link_guest_goes_through_the_lobby_on_a_reserved_code(): void
    {
        $this->asUser('alice')->postJson('/api/v1/meetings/rooms', [
            'room' => self::RESERVED_CODE,
            'ownerPrincipal' => 'u:alice',
        ])->assertCreated();

        $this->linkGuestJoin(self::RESERVED_CODE, 'peer-guest', 'Visitor')
            ->assertForbidden()->assertJsonPath('error', 'knock_required');

        $knock = $this->linkGuestJoin(self::RESERVED_CODE, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertOk();
        // A guest session, not an account: the server hands out a session key.
        $this->assertIsString($knock->json('sessionKey'));
    }

    public function test_link_guest_joins_an_unreserved_code_as_a_guest_session(): void
    {
        $join = $this->linkGuestJoin(self::OPEN_CODE, 'peer-guest', 'Visitor')->assertOk();

        $this->assertIsString($join->json('sessionKey'));
    }

    public function test_link_guest_cannot_reserve_or_update_a_meeting_room(): void
    {
        $this->withBearer($this->linkGuestToken())->postJson('/api/v1/meetings/rooms', [
            'room' => self::RESERVED_CODE,
            'ownerPrincipal' => 'u:alice',
        ])->assertForbidden()->assertJsonPath('code', 'forbidden');
        $this->assertNull(MeetReservation::query()->find(self::RESERVED_CODE));

        $this->asUser('alice')->postJson('/api/v1/meetings/rooms', [
            'room' => self::RESERVED_CODE,
            'ownerPrincipal' => 'u:alice',
        ])->assertCreated();

        $this->withBearer($this->linkGuestToken())
            ->patchJson('/api/v1/meetings/rooms/'.self::RESERVED_CODE, ['expiresAt' => null])
            ->assertForbidden()->assertJsonPath('code', 'forbidden');
        $this->withBearer($this->linkGuestToken())
            ->patchJson('/api/v1/meetings/rooms/unknown-code-x', ['expiresAt' => null])
            ->assertForbidden()->assertJsonPath('code', 'forbidden');
    }

    private function linkGuestJoin(string $room, string $peerId, string $name): TestResponse
    {
        return $this->withBearer($this->linkGuestToken())->postJson('/api/v1/rooms/'.$room.'/participants', [
            'peerId' => $peerId,
            'name' => $name,
        ]);
    }

    private function linkGuestToken(): string
    {
        return app(JwtTokenService::class)->issue([
            'sub' => 'share:meet-link-guest',
            'role' => 'guest',
            'exp' => time() + 3600,
        ]);
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
