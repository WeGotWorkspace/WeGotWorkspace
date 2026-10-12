<?php

declare(strict_types=1);

namespace App\Services\Collab;

/**
 * Contract C2 wire format for the collaboration ticket:
 * `base64url(JSON payload) . "." . base64url(signature)`.
 *
 * The signature is ECDSA P-256 / SHA-256 in IEEE P1363 form (r‖s, 64 bytes),
 * because that is the only encoding `crypto.subtle.verify` accepts. PHP's
 * `openssl_sign` emits DER, so {@see derToP1363()} rewrites it before the
 * ticket leaves the server.
 *
 * Everything here is pure: no keys, no database, no clock of its own.
 */
final class CollabTicketCodec
{
    public const TICKET_VERSION = 1;

    /** A ticket outlives its grid step so a client always holds a valid one while refreshing. */
    public const TICKET_TTL_SECONDS = 900;

    /**
     * Refresh runs without per-peer server state: `iat` snaps to this absolute
     * grid, so every ticket minted inside one step is the same string and the
     * previous step's ticket has exactly five minutes left when the step rolls
     * over — the moment C2 asks for a refresh.
     */
    public const REFRESH_INTERVAL_SECONDS = 600;

    /**
     * How long after a grid step starts the collab poll keeps answering in full
     * instead of `204 No Content`, so every polling peer picks up the new ticket
     * long before the one it holds expires.
     */
    public const HANDOVER_SECONDS = 30;

    private const COORDINATE_BYTES = 32;

    /**
     * @return array{v: int, kid: string, room: string, user: string, peer: string, access: string, iat: int, exp: int}
     */
    public static function payload(
        string $kid,
        string $roomKey,
        string $username,
        string $peerId,
        string $access,
        int $now,
    ): array {
        $issuedAt = self::issuedAt($now);

        return [
            'v' => self::TICKET_VERSION,
            'kid' => $kid,
            'room' => $roomKey,
            'user' => $username,
            'peer' => $peerId,
            'access' => $access,
            'iat' => $issuedAt,
            'exp' => $issuedAt + self::TICKET_TTL_SECONDS,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function signingInput(array $payload): string
    {
        return self::base64UrlEncode(
            json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  string  $p1363Signature  64 raw bytes (r‖s)
     */
    public static function assemble(array $payload, string $p1363Signature): string
    {
        return self::signingInput($payload).'.'.self::base64UrlEncode($p1363Signature);
    }

    /**
     * @return array{v: int, kid: string, room: string, user: string, peer: string, access: string, iat: int, exp: int}|null
     */
    public static function decodePayload(string $ticket): ?array
    {
        $parts = explode('.', $ticket);
        if (count($parts) !== 2) {
            return null;
        }

        $decoded = json_decode(self::base64UrlDecode($parts[0]), true);
        if (! is_array($decoded) || ($decoded['v'] ?? null) !== self::TICKET_VERSION) {
            return null;
        }
        foreach (['kid', 'room', 'user', 'peer', 'access'] as $field) {
            if (! is_string($decoded[$field] ?? null)) {
                return null;
            }
        }
        if (! is_int($decoded['iat'] ?? null) || ! is_int($decoded['exp'] ?? null)) {
            return null;
        }

        /** @var array{v: int, kid: string, room: string, user: string, peer: string, access: string, iat: int, exp: int} $decoded */
        return $decoded;
    }

    public static function issuedAt(int $now): int
    {
        return intdiv($now, self::REFRESH_INTERVAL_SECONDS) * self::REFRESH_INTERVAL_SECONDS;
    }

    public static function inHandoverWindow(int $now): bool
    {
        return $now - self::issuedAt($now) < self::HANDOVER_SECONDS;
    }

    /** DER `SEQUENCE { INTEGER r, INTEGER s }` to the fixed-width r‖s a browser expects. */
    public static function derToP1363(string $der): string
    {
        $offset = 0;
        self::expectTag($der, $offset, "\x30");
        self::readLength($der, $offset);
        $r = self::readInteger($der, $offset);
        $s = self::readInteger($der, $offset);

        return self::pad($r).self::pad($s);
    }

    /** The inverse, so `openssl_verify` can check what a browser would check. */
    public static function p1363ToDer(string $signature): string
    {
        if (strlen($signature) !== self::COORDINATE_BYTES * 2) {
            throw new \RuntimeException('A P1363 ECDSA signature is 64 bytes.');
        }

        $body = self::derInteger(substr($signature, 0, self::COORDINATE_BYTES))
            .self::derInteger(substr($signature, self::COORDINATE_BYTES));

        return "\x30".self::derLength(strlen($body)).$body;
    }

    public static function base64UrlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    public static function base64UrlDecode(string $encoded): string
    {
        $padded = strtr($encoded, '-_', '+/');
        $remainder = strlen($padded) % 4;
        if ($remainder !== 0) {
            $padded .= str_repeat('=', 4 - $remainder);
        }

        return (string) base64_decode($padded, true);
    }

    private static function expectTag(string $der, int &$offset, string $tag): void
    {
        if (($der[$offset] ?? '') !== $tag) {
            throw new \RuntimeException('Unexpected DER tag in the ECDSA signature.');
        }
        $offset++;
    }

    private static function readLength(string $der, int &$offset): int
    {
        $first = ord($der[$offset] ?? "\x00");
        $offset++;
        if ($first < 0x80) {
            return $first;
        }

        $length = 0;
        for ($i = 0; $i < ($first & 0x7F); $i++) {
            $length = ($length << 8) | ord($der[$offset] ?? "\x00");
            $offset++;
        }

        return $length;
    }

    private static function readInteger(string $der, int &$offset): string
    {
        self::expectTag($der, $offset, "\x02");
        $length = self::readLength($der, $offset);
        $value = substr($der, $offset, $length);
        if (strlen($value) !== $length) {
            throw new \RuntimeException('Truncated DER integer in the ECDSA signature.');
        }
        $offset += $length;

        return $value;
    }

    private static function pad(string $value): string
    {
        $trimmed = ltrim($value, "\x00");
        if (strlen($trimmed) > self::COORDINATE_BYTES) {
            throw new \RuntimeException('ECDSA signature component wider than the P-256 curve.');
        }

        return str_pad($trimmed, self::COORDINATE_BYTES, "\x00", STR_PAD_LEFT);
    }

    private static function derInteger(string $value): string
    {
        $trimmed = ltrim($value, "\x00");
        if ($trimmed === '') {
            $trimmed = "\x00";
        }
        if (ord($trimmed[0]) >= 0x80) {
            $trimmed = "\x00".$trimmed;
        }

        return "\x02".self::derLength(strlen($trimmed)).$trimmed;
    }

    private static function derLength(int $length): string
    {
        return $length < 0x80 ? chr($length) : "\x81".chr($length);
    }
}
