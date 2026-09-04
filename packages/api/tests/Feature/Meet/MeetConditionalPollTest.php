<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Tests\Support\WgwDatabaseTestCase;

/**
 * Conditional "nothing new" contract on GET /rooms/{roomId}/events: clients echo the
 * `rosterSig` of a previous poll via `?sig=`; the server answers 204 No Content when
 * the roster is unchanged and no messages are pending for the peer.
 */
final class MeetConditionalPollTest extends WgwDatabaseTestCase
{
    private const ROOM_ID = 'cond-poll-room';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
    }

    /**
     * @return array{peerId: string, sessionKey: string}
     */
    private function joinAsGuest(string $peerId, string $name): array
    {
        $join = $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/participants', [
            'peerId' => $peerId,
            'name' => $name,
        ]);
        $join->assertOk();

        return ['peerId' => $peerId, 'sessionKey' => (string) $join->json('sessionKey')];
    }

    private function pollUrl(string $peerId, string $sessionKey, ?string $sig = null): string
    {
        $url = '/api/v1/rooms/'.self::ROOM_ID.'/events?peerId='.$peerId.'&sessionKey='.$sessionKey;
        if ($sig !== null) {
            $url .= '&sig='.urlencode($sig);
        }

        return $url;
    }

    public function test_poll_without_sig_returns_roster_signature(): void
    {
        $guest = $this->joinAsGuest('peer-alpha1', 'Guest One');

        $poll = $this->getJson($this->pollUrl($guest['peerId'], $guest['sessionKey']));

        $poll->assertOk();
        $poll->assertJsonStructure(['peers', 'messages', 'rosterSig']);
        $this->assertIsString($poll->json('rosterSig'));
        $this->assertNotSame('', $poll->json('rosterSig'));
    }

    public function test_poll_with_matching_sig_returns_204(): void
    {
        $guest = $this->joinAsGuest('peer-alpha1', 'Guest One');

        $first = $this->getJson($this->pollUrl($guest['peerId'], $guest['sessionKey']));
        $first->assertOk();
        $sig = (string) $first->json('rosterSig');

        $second = $this->getJson($this->pollUrl($guest['peerId'], $guest['sessionKey'], $sig));
        $second->assertNoContent();
    }

    public function test_poll_with_stale_sig_returns_full_payload(): void
    {
        $guest = $this->joinAsGuest('peer-alpha1', 'Guest One');

        $poll = $this->getJson($this->pollUrl($guest['peerId'], $guest['sessionKey'], 'deadbeef'));

        $poll->assertOk();
        $poll->assertJsonStructure(['peers', 'messages', 'rosterSig']);
    }

    public function test_roster_change_invalidates_sig(): void
    {
        $guest = $this->joinAsGuest('peer-alpha1', 'Guest One');

        $first = $this->getJson($this->pollUrl($guest['peerId'], $guest['sessionKey']));
        $sig = (string) $first->json('rosterSig');

        $this->joinAsGuest('peer-bravo1', 'Guest Two');

        $second = $this->getJson($this->pollUrl($guest['peerId'], $guest['sessionKey'], $sig));
        $second->assertOk();
        $second->assertJsonPath('peers.0.id', 'peer-bravo1');
        $this->assertNotSame($sig, $second->json('rosterSig'));
    }

    public function test_pending_message_bypasses_204_and_is_not_lost(): void
    {
        $host = $this->joinAsGuest('peer-alpha1', 'Host');
        $guest = $this->joinAsGuest('peer-bravo1', 'Guest');

        // Host learns the two-peer roster signature.
        $rosterPoll = $this->getJson($this->pollUrl($host['peerId'], $host['sessionKey']));
        $rosterPoll->assertOk();
        $sig = (string) $rosterPoll->json('rosterSig');

        $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/messages', [
            'from' => $guest['peerId'],
            'text' => 'Hello host',
            'sessionKey' => $guest['sessionKey'],
        ])->assertOk();

        // Same sig, but a message is pending: full payload with the chat line.
        $withMessage = $this->getJson($this->pollUrl($host['peerId'], $host['sessionKey'], $sig));
        $withMessage->assertOk();
        $messages = $withMessage->json('messages');
        $this->assertIsArray($messages);
        $this->assertCount(1, $messages);
        $this->assertSame('chat', $messages[0]['type']);

        // Message consumed (delete-on-read) and roster unchanged: back to 204.
        $drained = $this->getJson($this->pollUrl($host['peerId'], $host['sessionKey'], $sig));
        $drained->assertNoContent();
    }
}
