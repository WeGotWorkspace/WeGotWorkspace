<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Exceptions\ApiHttpException;

final class NoteUidConflict
{
    public static function throwIf(\Throwable $exception): void
    {
        $message = $exception->getMessage();
        if (
            str_contains($message, 'calendarid_uid')
            || str_contains($message, 'UNIQUE constraint failed')
            || str_contains($message, 'Duplicate entry')
        ) {
            throw new ApiHttpException(409, 'A note with this UID already exists.', 'alreadyExists');
        }
    }
}
