<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;
use App\Services\Notes\Conversion\NoteJournalConverter;

/**
 * #1535: an archived note (STATUS:CANCELLED) does not change until it is
 * restored. Restore, archive, delete, and the personal star stay open.
 */
final class NoteArchiveGuard
{
    /** Patch keys that change the note. `status` alone is restore or archive. */
    private const CHANGING_KEYS = ['title', 'body', 'categories', 'categoriesAdd', 'categoriesRemove', 'notebookId', 'yjs'];

    /**
     * Same shape as `external_write` (#1381): 409, and the message is the
     * code too, because the shared collab client reads `error`.
     */
    public const ERROR = 'note_archived';

    /**
     * @param  array<string, mixed>  $patch
     */
    public static function assertPatchAllowed(NoteJournalConverter $converter, CalendarObject $object, array $patch): void
    {
        if (array_intersect_key($patch, array_flip(self::CHANGING_KEYS)) === []) {
            return;
        }
        self::assertNotArchived($converter, $object);
    }

    public static function assertNotArchived(NoteJournalConverter $converter, CalendarObject $object): void
    {
        if (self::isArchived($converter, $object)) {
            throw new ApiHttpException(409, self::ERROR, self::ERROR);
        }
    }

    public static function isArchived(NoteJournalConverter $converter, CalendarObject $object): bool
    {
        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;

        return $converter->fromIcs($raw, (string) $object->uid)['status'] === 'CANCELLED';
    }
}
