<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Services\Rtc\RoomIdCodec;

/**
 * Room id validation for collab signaling and document persistence.
 *
 * A collab room is either a drive virtual path or a note VJOURNAL UID. Drive
 * paths carry whatever the filesystem accepts — accents, parentheses, `&` — so
 * the room is validated as a normalized path instead of matched against an
 * ASCII identifier charset.
 */
final class CollabRoomPolicy
{
    /** @var non-empty-string */
    private const DOCUMENT_EXTENSIONS =
        'csv|env|html|ini|json|log|md|markdown|toml|txt|xml|yaml|yml';

    /** Characters, not bytes: a path of accented characters is not half as long. */
    private const MAX_ROOM_CHARACTERS = 1024;

    /**
     * Canonical room: a normalized drive path without its leading slash, or a note UID.
     */
    public function cleanRoom(mixed $room): string
    {
        if (! is_string($room)) {
            $this->fail('invalid_room');
        }

        $canonical = RoomIdCodec::canonicalFilePath($room);
        if (! $this->isCanonicalRoom($canonical)) {
            $this->fail('invalid_room');
        }

        return $canonical;
    }

    /**
     * Drive virtual path to an editable text document (explicit extension allowlist).
     */
    public function cleanDocumentPath(mixed $room): string
    {
        $room = $this->cleanRoom($room);
        if (! preg_match('/\.(?:'.self::DOCUMENT_EXTENSIONS.')$/i', $room)) {
            $this->fail('invalid_document_path');
        }

        return $room;
    }

    /**
     * Contract C5: `collab_peers.room` and `collab_messages.room` hold a 40-hex
     * digest of the canonical room, so any path fits the column and no character
     * of a user's filename reaches the signaling tables. Authorization never runs
     * on this key — it runs on the canonical path that produced it.
     */
    public function roomKey(string $canonicalRoom): string
    {
        return sha1($canonicalRoom);
    }

    /**
     * A canonical room is non-empty UTF-8 of at most 1024 characters whose segments
     * are all non-empty and none of which traverses the tree. Backslashes and
     * surrounding whitespace are rejected rather than normalized away, because the
     * drive path normalizer would rewrite them and the room key would stop matching
     * the path that authorization sees.
     */
    private function isCanonicalRoom(string $room): bool
    {
        if ($room === '' || mb_strlen($room) > self::MAX_ROOM_CHARACTERS) {
            return false;
        }
        if (! mb_check_encoding($room, 'UTF-8')) {
            return false;
        }
        if (trim($room) !== $room || str_contains($room, '\\')) {
            return false;
        }
        if (preg_match('/[\x00-\x1f\x7f]/u', $room) === 1) {
            return false;
        }

        foreach (explode('/', $room) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return false;
            }
        }

        return true;
    }

    private function fail(string $error, int $status = 400, ?string $message = null): never
    {
        $payload = ['error' => $error];
        if ($message !== null) {
            $payload['message'] = $message;
        }
        throw new CollabResponseException($status, $payload);
    }
}
