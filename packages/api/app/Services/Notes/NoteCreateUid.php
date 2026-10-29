<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;
use Illuminate\Support\Str;

/**
 * Picks the UID a new note gets. UIDs stay unique across every VJOURNAL
 * (the collab room key), but the answer to a create only depends on notes
 * the caller can see:
 *
 * - a free UID is kept;
 * - a UID of a note the caller can see is a 409, as before;
 * - a UID that only notes out of the caller's reach use is not kept: the
 *   note gets a fresh UID, like a client UID that is not a UUID.
 *
 * Call inside the create transaction: the read locks the UID until the insert.
 */
final class NoteCreateUid
{
    public function resolve(NotebookRepository $notebooks, string $username, string $uid): string
    {
        $calendarIds = CalendarObject::query()
            ->where('uid', $uid)
            ->where('componenttype', 'VJOURNAL')
            ->lockForUpdate()
            ->pluck('calendarid');
        if ($calendarIds->isEmpty()) {
            return $uid;
        }

        foreach ($calendarIds as $calendarId) {
            if ($notebooks->findAccessibleInstanceForCalendar($username, (int) $calendarId) !== null) {
                throw new ApiHttpException(409, NoteMoveHelper::UID_CONFLICT, 'alreadyExists');
            }
        }

        return (string) Str::uuid();
    }
}
