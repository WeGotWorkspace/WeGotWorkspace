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
    /** Under `groups/{team}/.project-archive/`: kept in the file index, out of search and client reach (#819). */
    case ProjectArchive = 'project_archive';

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
                $class = self::moreRestrictive($class, self::Trash);

                continue;
            }
            if ($segment === DocAttachmentPaths::DIR) {
                $class = self::moreRestrictive($class, self::Attachment);

                continue;
            }
            if ($segment === self::NOTES_DIR) {
                $underNotes = true;
                $class = self::moreRestrictive($class, self::Note);

                continue;
            }
            if ($segment === self::NOTES_ARCHIVE_DIR && $underNotes) {
                continue;
            }
            if ($segment === ProjectArchivePaths::DIR) {
                $class = self::moreRestrictive($class, self::ProjectArchive);

                continue;
            }
            if (str_starts_with($segment, '.')) {
                return self::Hidden;
            }
        }

        return $class;
    }

    /**
     * Hidden beats project archive beats trash beats attachment beats note beats regular,
     * whatever order the segments appear in.
     */
    private static function moreRestrictive(self $current, self $candidate): self
    {
        return self::rank($candidate) > self::rank($current) ? $candidate : $current;
    }

    private static function rank(self $class): int
    {
        return match ($class) {
            self::Regular => 0,
            self::Note => 1,
            self::Attachment => 2,
            self::Trash => 3,
            self::ProjectArchive => 4,
            self::Hidden => 5,
        };
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
