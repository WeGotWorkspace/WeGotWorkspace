<?php

declare(strict_types=1);

namespace App\Storage;

use App\Services\Drive\DocAttachmentPaths;

/**
 * Single source of truth for what a storage key *is*. Both the JMAP file index
 * and the unified search index classify keys here; they differ only in which
 * classes they keep, never in how a key is read.
 */
enum StorageKeyClass: string
{
    case Regular = 'regular';
    case Note = 'note';
    case Trash = 'trash';
    case Attachment = 'attachment';
    case Hidden = 'hidden';

    private const TRASH_DIR = '.Trash';

    private const NOTES_DIR = '.notes';

    private const NOTES_ARCHIVE_DIR = '.archive';

    public static function classify(string $key): self
    {
        $underNotes = false;
        $class = self::Regular;
        foreach (explode('/', trim(str_replace('\\', '/', $key), '/')) as $segment) {
            if ($segment === '') {
                continue;
            }
            if ($segment === self::TRASH_DIR) {
                $class = self::Trash;

                continue;
            }
            if ($segment === DocAttachmentPaths::DIR) {
                $class = self::Attachment;

                continue;
            }
            if ($segment === self::NOTES_DIR) {
                $underNotes = true;
                $class = self::Note;

                continue;
            }
            if ($segment === self::NOTES_ARCHIVE_DIR && $underNotes) {
                continue;
            }
            if (str_starts_with($segment, '.')) {
                return self::Hidden;
            }
        }

        return $class;
    }

    /** Kept in the JMAP file index (Drive needs trash and attachments). */
    public function isFileIndexed(): bool
    {
        return $this !== self::Hidden;
    }

    /** Kept in the unified search index (Docs/search must not show trash or attachments). */
    public function isSearchIndexed(): bool
    {
        return $this === self::Regular || $this === self::Note;
    }
}
