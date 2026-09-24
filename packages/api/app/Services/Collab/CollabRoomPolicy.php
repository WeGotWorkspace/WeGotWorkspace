<?php

declare(strict_types=1);

namespace App\Services\Collab;

/**
 * Room id validation for collab signaling and document persistence.
 */
final class CollabRoomPolicy
{
    /** @var non-empty-string */
    private const DOCUMENT_EXTENSIONS =
        'csv|env|html|ini|json|log|md|markdown|toml|txt|xml|yaml|yml';

    public function cleanRoom(mixed $room): string
    {
        if (! is_string($room)) {
            $this->fail('invalid_room');
        }
        $room = ltrim($room, '/');
        if (! preg_match('/^[A-Za-z0-9._~\/ -]{4,190}$/', $room)) {
            $this->fail('invalid_room');
        }

        return $room;
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

    private function fail(string $error, int $status = 400, ?string $message = null): never
    {
        $payload = ['error' => $error];
        if ($message !== null) {
            $payload['message'] = $message;
        }
        throw new CollabResponseException($status, $payload);
    }
}
