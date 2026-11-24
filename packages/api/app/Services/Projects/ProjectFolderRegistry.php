<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\JmapFileNode;
use App\Models\ProjectResource;

/**
 * "Is this storage key a Project folder?" (#817 A3), for the guards that refuse a
 * client delete, rename or move of the folder itself over REST, JMAP `FileNode/set`
 * and DAV. Everything inside the folder is not a Project folder.
 *
 * A Project folder always sits directly in a Team Drive (`groups/{team}/{name}`), so
 * every other key answers without a query. The set of folder keys is read once per
 * request.
 */
final class ProjectFolderRegistry
{
    /** @var array<string, true>|null */
    private ?array $keys = null;

    public function isProjectFolderKey(string $key): bool
    {
        $key = trim((string) preg_replace('#/+#', '/', $key), '/');
        if (preg_match('#^groups/[^/]+/[^/]+$#', $key) !== 1) {
            return false;
        }

        return isset($this->keys()[$key]);
    }

    public function forget(): void
    {
        $this->keys = null;
    }

    /** @return array<string, true> */
    private function keys(): array
    {
        if ($this->keys !== null) {
            return $this->keys;
        }
        $nodeIds = ProjectResource::query()
            ->where('kind', ProjectKind::DriveFolder->value)
            ->pluck('locator')
            ->map(static fn (mixed $locator): string => (string) $locator)
            ->all();
        $this->keys = [];
        foreach (array_chunk($nodeIds, 500) as $chunk) {
            foreach (JmapFileNode::query()->whereIn('node_id', $chunk)->whereNull('deleted_at')->pluck('storage_key') as $key) {
                $this->keys[(string) $key] = true;
            }
        }

        return $this->keys;
    }
}
