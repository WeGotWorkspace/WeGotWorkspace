<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Services\Drive\DriveShareAuthorizer;
use App\Services\Notes\NoteRepository;
use App\Services\Rtc\Signaling\RtcPeerAccess;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Access check for joining a collab signaling room.
 *
 * Joining exposes the roster and offer/answer mailbox, which is all a peer
 * needs to receive Yjs document sync — so joining mirrors document read
 * access. Decoded rooms have two known shapes: a drive virtual path (any
 * room containing a slash — the docs app strips the leading `/`, so both
 * `/groups/team/doc.md` and `groups/team/doc.md` arrive here) or a note
 * VJOURNAL UID (no slash at all).
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
        if (str_contains($room, '/')) {
            $this->assertMayReadDrivePath('/'.ltrim($room, '/'), $principal);

            return;
        }

        $this->assertMayReadNote($room, $principal['username']);
    }

    /**
     * The right the server stores on the peer row and mirrors on the roster
     * (contract C1). Computed here, at join, from the same share rights the
     * document endpoints use — a client never gets to claim its own.
     *
     * @param  array{username: string, role: string}  $principal
     * @return 'read'|'comment'|'write'
     */
    public function accessFor(string $room, array $principal): string
    {
        if (str_contains($room, '/')) {
            $rights = $this->driveShares->effectiveRights('/'.ltrim($room, '/'), $principal);
            if ($rights['mayEditContent']) {
                return RtcPeerAccess::WRITE;
            }

            return $rights['mayComment'] ? RtcPeerAccess::COMMENT : RtcPeerAccess::READ;
        }

        $note = $this->notes->findAccessibleNote($principal['username'], $room);
        if ($note === null) {
            return RtcPeerAccess::READ;
        }

        $access = (int) ($note['instance']->access ?? SharingPlugin::ACCESS_SHAREDOWNER);

        return $access === SharingPlugin::ACCESS_READ ? RtcPeerAccess::READ : RtcPeerAccess::WRITE;
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
