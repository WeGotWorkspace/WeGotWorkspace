<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Services\VObject\VJournalUidGuard;

final class NoteUidConflict
{
    public static function throwIf(\Throwable $exception): void
    {
        VJournalUidGuard::throwIfUniqueViolation($exception, NoteMoveHelper::UID_CONFLICT);
    }
}
