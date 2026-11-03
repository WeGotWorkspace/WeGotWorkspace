<?php

declare(strict_types=1);

namespace App\Services\VObject;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;

/**
 * A VJOURNAL UID is unique across every pool: notes use it as the collab
 * room key, Docs threads as the client-chosen thread or reply id.
 *
 * Call both methods inside the create transaction, so the check and the
 * insert cannot be split by a concurrent create with the same UID.
 */
final class VJournalUidGuard
{
    /**
     * Throws 409 alreadyExists when a VJOURNAL in another calendar has this
     * UID. When $exceptCalendarId is set, that calendar is ignored (a move,
     * or a create that treats its own pool as idempotent).
     *
     * The read is a locking read. Inside a transaction it holds the UID until
     * the insert: a row or gap lock on the calendarobjects(uid, componenttype)
     * index on MySQL; on SQLite the IMMEDIATE transaction already holds the
     * write lock.
     */
    public function assertAvailable(string $uid, string $conflictMessage, ?int $exceptCalendarId = null): void
    {
        $query = CalendarObject::query()
            ->where('uid', $uid)
            ->where('componenttype', 'VJOURNAL')
            ->lockForUpdate();
        if ($exceptCalendarId !== null) {
            $query->where('calendarid', '!=', $exceptCalendarId);
        }
        if ($query->exists()) {
            throw new ApiHttpException(409, $conflictMessage, 'alreadyExists');
        }
    }

    /**
     * Rethrows a unique-index violation as the 409 the check would have given.
     * Any other database error is left for the caller to rethrow.
     */
    public static function throwIfUniqueViolation(\Throwable $exception, string $conflictMessage): void
    {
        $message = $exception->getMessage();
        if (
            str_contains($message, 'calendarid_uid')
            || str_contains($message, 'UNIQUE constraint failed')
            || str_contains($message, 'Duplicate entry')
        ) {
            throw new ApiHttpException(409, $conflictMessage, 'alreadyExists');
        }
    }
}
