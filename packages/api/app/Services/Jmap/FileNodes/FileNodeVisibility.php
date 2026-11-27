<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Storage\ProjectArchivePaths;

/** Which storage keys an account's FileNode views may show. */
final class FileNodeVisibility
{
    /**
     * Storage-key prefixes of the account's own tree: the personal home plus
     * member group trees. Live member-grant share roots are visible to the
     * grantee (#990) but are not minted here — FileNodeAccountSupport indexes
     * them with their real parent.
     *
     * @param  list<string>  $groupSlugs
     * @return list<string>
     */
    public static function roots(string $username, array $groupSlugs): array
    {
        $roots = ['users/'.$username];
        foreach ($groupSlugs as $slug) {
            $roots[] = 'groups/'.$slug;
        }

        return $roots;
    }

    /**
     * Whether the key is a list path: no segment starts with `.`, except `.Trash` (#2063).
     * `.notes` and `.attachments` are file-indexed, but clients never list what is inside them.
     */
    public static function isListKey(string $key): bool
    {
        foreach (explode('/', $key) as $segment) {
            if ($segment !== '.Trash' && str_starts_with($segment, '.')) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  list<string>  $roots
     */
    public static function isVisibleKey(string $key, array $roots): bool
    {
        // Archived Project folders keep their nodes but no client sees them (#819).
        if (ProjectArchivePaths::isUnder($key)) {
            return false;
        }
        foreach ($roots as $root) {
            if ($key === $root || str_starts_with($key, $root.'/')) {
                return true;
            }
        }

        return false;
    }
}
