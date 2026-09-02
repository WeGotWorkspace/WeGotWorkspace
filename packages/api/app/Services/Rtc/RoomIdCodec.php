<?php

declare(strict_types=1);

namespace App\Services\Rtc;

/**
 * Encodes file paths and meet room ids into URL-safe roomId path segments.
 */
final class RoomIdCodec
{
    private const FILE_PREFIX = 'f_';

    private const PRINCIPAL_PREFIX = 'p_';

    public function encodeFilePath(string $path): string
    {
        $encoded = rtrim(strtr(base64_encode($path), '+/', '-_'), '=');

        return self::FILE_PREFIX.$encoded;
    }

    /**
     * Principal rooms are plain tokens (`workspace`, `groups.{slug}`) — no encoding,
     * the room charset already fits the roomId path segment.
     */
    public function encodePrincipalRoom(string $room): string
    {
        return self::PRINCIPAL_PREFIX.$room;
    }

    /**
     * @return array{channel: 'meet'|'collab'|'principal', room: string}
     */
    public function decode(string $roomId): array
    {
        if (str_starts_with($roomId, self::FILE_PREFIX)) {
            $payload = substr($roomId, strlen(self::FILE_PREFIX));
            $padding = strlen($payload) % 4;
            if ($padding > 0) {
                $payload .= str_repeat('=', 4 - $padding);
            }
            $path = base64_decode(strtr($payload, '-_', '+/'), true);
            if (! is_string($path) || $path === '') {
                throw new \InvalidArgumentException('Invalid file room id.');
            }

            return ['channel' => 'collab', 'room' => $path];
        }

        if (str_starts_with($roomId, self::PRINCIPAL_PREFIX)) {
            $room = substr($roomId, strlen(self::PRINCIPAL_PREFIX));
            if ($room === '') {
                throw new \InvalidArgumentException('Invalid principal room id.');
            }

            return ['channel' => 'principal', 'room' => $room];
        }

        return ['channel' => 'meet', 'room' => $roomId];
    }
}
