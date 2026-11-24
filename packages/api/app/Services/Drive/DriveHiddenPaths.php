<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Storage\ProjectArchivePaths;

/**
 * Server-owned trees that no Drive listing, search or starred list shows: Notes
 * storage, doc attachments, and the folders of archived Projects (#819).
 *
 * `.Trash` is not one of them: trash is a move, so a star follows the item and comes
 * back on restore.
 */
final class DriveHiddenPaths
{
    public static function isHidden(string $virtualPath): bool
    {
        return preg_match('#/(?:users|groups)/[^/]+/\.notes(?:/|$)#', $virtualPath) === 1
            || DocAttachmentPaths::isHiddenBrowseVirtualPath($virtualPath)
            || ProjectArchivePaths::isUnder($virtualPath);
    }
}
