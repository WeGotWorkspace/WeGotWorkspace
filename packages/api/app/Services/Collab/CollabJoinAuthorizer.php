<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Exceptions\RealtimeApiException;
use App\Services\Drive\DriveShareAuthorizer;
use App\Services\Notes\Conversion\NoteJournalConverter;
use App\Services\Notes\NoteArchiveGuard;
use App\Services\Notes\NoteRepository;
use App\Services\Rtc\Signaling\RtcPeerAccess;
use App\Services\Tasks\TaskLocator;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Access check for joining a collab signaling room.
 *
 * Joining exposes the roster and offer/answer mailbox, which is all a peer
 * needs to receive Yjs document sync — so joining mirrors document read
 * access. Decoded rooms have three known shapes, tested in this order: a
 * task's live text, `task:<calendarid>:<vtodo-uid>` (#2208; the UID may hold
 * a slash); a drive virtual path (any room containing a slash — the docs app
 * strips the leading `/`, so both `/groups/team/doc.md` and
 * `groups/team/doc.md` arrive here); or a note VJOURNAL UID (no slash).
 */
final class CollabJoinAuthorizer
{
    private const TASK_PREFIX = 'task:';

    public function __construct(
        private DriveShareAuthorizer $driveShares,
        private NoteRepository $notes,
        private NoteJournalConverter $converter,
        private TaskLocator $tasks,
    ) {}

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function assertMayJoin(string $room, array $principal): void
    {
        if (str_starts_with($room, self::TASK_PREFIX)) {
            if ($this->tasks->findForRoom($principal['username'], $room) === null) {
                $this->deny();
            }

            return;
        }
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
        if (str_starts_with($room, self::TASK_PREFIX)) {
            $task = $this->tasks->findForRoom($principal['username'], $room);

            return $task === null ? RtcPeerAccess::READ : $this->writeUnlessReadOnly($task['instance']->access);
        }
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

        // An archived note does not change until it is restored (#1535).
        if (NoteArchiveGuard::isArchived($this->converter, $note['object'])) {
            return RtcPeerAccess::READ;
        }

        return $this->writeUnlessReadOnly($note['instance']->access);
    }

    /** @return 'read'|'write' */
    private function writeUnlessReadOnly(mixed $access): string
    {
        $access = (int) ($access ?? SharingPlugin::ACCESS_SHAREDOWNER);

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
        throw new RealtimeApiException(403, 'forbidden', 'You do not have access to this document.');
    }
}
