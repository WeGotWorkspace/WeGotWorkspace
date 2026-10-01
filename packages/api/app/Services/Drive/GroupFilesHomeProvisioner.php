<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Support\AppPaths;

/**
 * Ensures files/groups/{slug} exists for a group drive.
 */
final class GroupFilesHomeProvisioner
{
    public function __construct(private readonly AppPaths $paths) {}

    public function ensureForSlug(string $slug): void
    {
        if (preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/', $slug) !== 1) {
            throw new \InvalidArgumentException('Group slug must be 2–63 characters: lowercase letters, digits, underscore, or hyphen.');
        }

        $path = $this->pathForSlug($slug);
        if (is_dir($path)) {
            return;
        }
        if (! @mkdir($path, 0775, true) && ! is_dir($path)) {
            throw new \RuntimeException('Could not create group files directory for '.$slug.'.');
        }
    }

    /**
     * Create a missing drive home for every group principal.
     *
     * The container principal {@see AdminConstants::GROUP_CONTAINER_URI} is not a group.
     * URIs that are not a single slug segment are skipped so the path stays files/groups/{slug}.
     *
     * @return array{scanned: int, created: int, skipped: int}
     */
    public function ensureForAllGroupPrincipals(): array
    {
        $scanned = 0;
        $created = 0;
        $skipped = 0;

        Principal::query()
            ->where('uri', 'like', AdminConstants::GROUP_PREFIX.'%')
            ->orderBy('id')
            ->pluck('uri')
            ->each(function (mixed $uri) use (&$scanned, &$created, &$skipped): void {
                $slug = substr((string) $uri, strlen(AdminConstants::GROUP_PREFIX));
                if (preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/', $slug) !== 1) {
                    return;
                }

                $scanned++;
                if (is_dir($this->pathForSlug($slug))) {
                    $skipped++;

                    return;
                }

                $this->ensureForSlug($slug);
                $created++;
            });

        return ['scanned' => $scanned, 'created' => $created, 'skipped' => $skipped];
    }

    public function pathForSlug(string $slug): string
    {
        return rtrim($this->paths->dataDir(), '/').'/files/groups/'.$slug;
    }
}
