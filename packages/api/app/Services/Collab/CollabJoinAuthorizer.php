<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Services\Drive\DriveShareAuthorizer;
use App\Services\Notes\NoteRepository;

/**
 * Access check for joining a collab signaling room.
 *
 * Joining exposes the roster and offer/answer mailbox, which is all a peer
 * needs to receive Yjs document sync — so joining mirrors document read
 * access. Decoded rooms have two known shapes: a drive virtual path
 * (leading `/`) or a note VJOURNAL UID (no slash at all). Anything else
 * is denied.
 */
final class CollabJoinAuthorizer
{
    public function __construct(
        private DriveShareAuthorizer $driveShares,
        private NoteRepository $notes,
    ) {}

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function assertMayJoin(string $room, array $principal): void
    {
        if (str_starts_with($room, '/')) {
            $this->assertMayReadDrivePath($room, $principal);

            return;
        }

        if (! str_contains($room, '/')) {
            $this->assertMayReadNote($room, $principal['username']);

            return;
        }

        $this->deny();
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    private function assertMayReadDrivePath(string $path, array $principal): void
    {
        try {
            $this->driveShares->assertMayRead($path, $principal);
        } catch (\InvalidArgumentException) {
            $this->deny();
        }
    }

    private function assertMayReadNote(string $uid, string $username): void
    {
        if ($this->notes->findAccessibleNote($username, $uid) === null) {
            $this->deny();
        }
    }

    private function deny(): never
    {
        throw new CollabResponseException(403, [
            'error' => 'forbidden',
            'message' => 'You do not have access to this document.',
        ]);
    }
}
