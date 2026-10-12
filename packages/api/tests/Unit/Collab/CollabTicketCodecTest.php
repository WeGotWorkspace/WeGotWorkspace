<?php

declare(strict_types=1);

namespace Tests\Unit\Collab;

use App\Services\Collab\CollabTicketCodec;
use App\Services\Rtc\Signaling\RtcPeerAccess;
use PHPUnit\Framework\TestCase;

/**
 * Contract C2 wire format. The browser verifies with
 * `crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, …)`, which only
 * accepts IEEE P1363 (r‖s), so the DER that `openssl_sign` emits has to be
 * converted byte-exactly before it leaves the server.
 */
final class CollabTicketCodecTest extends TestCase
{
    // A C5 room digest, not a credential. Naming it `*_KEY` makes the secret
    // scanner read the hex as an API key and fail the Secrets check.
    private const ROOM_HASH = 'd0b3bd2f7a5f1b2c3d4e5f60718293a4b5c6d7e8';

    public function test_a_ticket_is_two_base64url_segments_joined_by_a_dot(): void
    {
        $ticket = CollabTicketCodec::assemble($this->payload(1_700_000_000), str_repeat("\x7f", 64));

        $this->assertSame(2, substr_count($ticket, '.') + 1);
        $this->assertDoesNotMatchRegularExpression('/[+\/=]/', $ticket);
    }

    public function test_the_payload_binds_version_key_room_user_peer_and_access(): void
    {
        $payload = $this->payload(1_700_000_000);

        $this->assertSame([
            'v' => 1,
            'kid' => 'fixture-kid',
            'room' => self::ROOM_HASH,
            'user' => 'carol',
            'peer' => '0123456789abcdef',
            'access' => RtcPeerAccess::COMMENT,
            'iat' => 1_699_999_800,
            'exp' => 1_700_000_700,
        ], $payload);
    }

    public function test_a_ticket_expires_fifteen_minutes_after_it_was_issued(): void
    {
        $payload = $this->payload(1_700_000_000);

        $this->assertSame(CollabTicketCodec::TICKET_TTL_SECONDS, $payload['exp'] - $payload['iat']);
    }

    /**
     * Refresh has to work without per-peer server state, so `iat` snaps to an
     * absolute ten-minute grid: every ticket minted inside one grid step is the
     * same string, and the previous step's ticket has exactly five minutes left
     * when the step rolls over — the C2 refresh trigger.
     */
    public function test_issued_at_snaps_to_the_refresh_grid(): void
    {
        $this->assertSame(1_699_999_800, CollabTicketCodec::issuedAt(1_699_999_800));
        $this->assertSame(1_699_999_800, CollabTicketCodec::issuedAt(1_700_000_399));
        $this->assertSame(1_700_000_400, CollabTicketCodec::issuedAt(1_700_000_400));
    }

    public function test_the_previous_grid_step_still_has_five_minutes_left_when_the_step_rolls_over(): void
    {
        $rollover = 1_700_000_400;
        $previous = $this->payload($rollover - 1);

        $this->assertSame(300, $previous['exp'] - $rollover);
    }

    public function test_the_handover_window_covers_the_start_of_every_grid_step(): void
    {
        $this->assertTrue(CollabTicketCodec::inHandoverWindow(1_700_000_400));
        $this->assertTrue(CollabTicketCodec::inHandoverWindow(1_700_000_429));
        $this->assertFalse(CollabTicketCodec::inHandoverWindow(1_700_000_430));
    }

    public function test_a_der_signature_becomes_sixty_four_p1363_bytes(): void
    {
        $der = $this->der(str_repeat("\x11", 32), str_repeat("\x22", 32));

        $this->assertSame(
            str_repeat("\x11", 32).str_repeat("\x22", 32),
            CollabTicketCodec::derToP1363($der),
        );
    }

    /** DER drops leading zero bytes; P1363 is fixed width, so they come back. */
    public function test_short_der_integers_are_left_padded_to_thirty_two_bytes(): void
    {
        $der = $this->der("\x01", "\x02\x03");

        $p1363 = CollabTicketCodec::derToP1363($der);

        $this->assertSame(64, strlen($p1363));
        $this->assertSame(str_pad("\x01", 32, "\x00", STR_PAD_LEFT), substr($p1363, 0, 32));
        $this->assertSame(str_pad("\x02\x03", 32, "\x00", STR_PAD_LEFT), substr($p1363, 32, 32));
    }

    /** DER prefixes a zero byte when the high bit is set; P1363 must not keep it. */
    public function test_the_der_sign_byte_is_stripped_from_high_bit_integers(): void
    {
        $r = str_repeat("\xff", 32);
        $der = $this->der($r, $r);

        $p1363 = CollabTicketCodec::derToP1363($der);

        $this->assertSame(64, strlen($p1363));
        $this->assertSame($r.$r, $p1363);
    }

    public function test_p1363_round_trips_through_der(): void
    {
        $signature = random_bytes(64);

        $this->assertSame(
            $signature,
            CollabTicketCodec::derToP1363(CollabTicketCodec::p1363ToDer($signature)),
        );
    }

    public function test_a_malformed_der_signature_is_refused(): void
    {
        $this->expectException(\RuntimeException::class);

        CollabTicketCodec::derToP1363("\x31\x02\x02\x01\x01");
    }

    public function test_decode_reads_back_the_payload_of_a_ticket(): void
    {
        $payload = $this->payload(1_700_000_000);
        $ticket = CollabTicketCodec::assemble($payload, random_bytes(64));

        $this->assertSame($payload, CollabTicketCodec::decodePayload($ticket));
    }

    public function test_decode_refuses_anything_that_is_not_a_c2_ticket(): void
    {
        $this->assertNull(CollabTicketCodec::decodePayload('not-a-ticket'));
        $this->assertNull(CollabTicketCodec::decodePayload('a.b.c'));
        $this->assertNull(CollabTicketCodec::decodePayload(
            CollabTicketCodec::base64UrlEncode('{"v":2}').'.'.CollabTicketCodec::base64UrlEncode('x'),
        ));
    }

    /**
     * @return array{v: int, kid: string, room: string, user: string, peer: string, access: string, iat: int, exp: int}
     */
    private function payload(int $now): array
    {
        return CollabTicketCodec::payload(
            'fixture-kid',
            self::ROOM_HASH,
            'carol',
            '0123456789abcdef',
            RtcPeerAccess::COMMENT,
            $now,
        );
    }

    private function der(string $r, string $s): string
    {
        $integer = static function (string $value): string {
            if (ord($value[0]) >= 0x80) {
                $value = "\x00".$value;
            }

            return "\x02".chr(strlen($value)).$value;
        };
        $body = $integer($r).$integer($s);

        return "\x30".(strlen($body) < 0x80 ? chr(strlen($body)) : "\x81".chr(strlen($body))).$body;
    }
}
