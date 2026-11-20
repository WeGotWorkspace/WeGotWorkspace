<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\JmapFileNode;
use App\Services\Drive\DrivePathBookkeeping;
use App\Services\Drive\GroupFilesHomeProvisioner;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeRelocator;
use App\Storage\ProjectArchivePaths;
use App\Storage\WgwStorage;
use Illuminate\Support\Str;

/**
 * The Drive folder of a Project (#817 A3): `files/groups/{team}/{name}`.
 *
 * Registered by its FileNode `node_id`, which survives rename and move. The folder
 * follows the Project's name and cannot be renamed, moved or deleted on its own
 * ({@see ProjectFolderRegistry}); only the Projects services change it, through the
 * same path bookkeeping as a Drive rename so shares, stars, threads and the index follow.
 *
 * Everything inside the folder is an ordinary file or folder.
 */
final class ProjectFolder
{
    private const NAME_MAX_LENGTH = 120;

    public function __construct(
        private readonly WgwStorage $storage,
        private readonly FileNodeIndexService $index,
        private readonly DrivePathBookkeeping $bookkeeping,
        private readonly GroupFilesHomeProvisioner $teamHomes,
        private readonly ProjectFolderRegistry $registry,
        private readonly FileNodeRelocator $relocator,
    ) {}

    /** Create the folder in the Team Drive and return its node id. A name clash gets a ` (2)` suffix. */
    public function create(string $teamSlug, string $projectName): string
    {
        $this->teamHomes->ensureForSlug($teamSlug);
        $key = $this->freeKey($teamSlug, self::folderName($projectName), null);
        $this->storage->files()->makeDirectory($key);
        $node = $this->index->recordCreate($key);
        if ($node === null) {
            throw new \RuntimeException('The Project folder '.$key.' could not be indexed.');
        }
        $this->registry->forget();

        return (string) $node->node_id;
    }

    /** The live folder for this node id, or null when it is gone from the index or the disk. */
    public function live(string $nodeId): ?JmapFileNode
    {
        $node = $this->index->liveByNodeId($nodeId);
        if ($node === null || ! $node->is_dir || ! $this->storage->files()->directoryExists((string) $node->storage_key)) {
            return null;
        }

        return $node;
    }

    /** Follow a Project rename. A name taken in the Team Drive gets a suffix. */
    public function rename(string $nodeId, string $teamSlug, string $projectName): void
    {
        $node = $this->live($nodeId);
        if ($node === null) {
            return;
        }
        $fromKey = (string) $node->storage_key;
        $toKey = $this->freeKey($teamSlug, self::folderName($projectName), $fromKey);
        if ($toKey === $fromKey) {
            return;
        }
        $this->moveTo($fromKey, $toKey);
    }

    private function moveTo(string $fromKey, string $toKey): void
    {
        if (! $this->storage->files()->move($fromKey, $toKey)) {
            throw new \RuntimeException('The Project folder could not be moved.');
        }
        $this->bookkeeping->afterMove($fromKey, $toKey);
        $this->registry->forget();
    }

    private function freeArchiveKey(string $key): string
    {
        $disk = $this->storage->files();
        for ($suffix = 2; $disk->exists($key.'-'.$suffix); $suffix++) {
        }

        return $key.'-'.$suffix;
    }

    /**
     * Archive: move the folder into the server-owned tree, `groups/{team}/.project-archive/{slug}`.
     * Node ids, shares and stars move with it; nothing under that tree reaches a client (#819).
     */
    public function archive(string $nodeId, string $teamSlug, string $projectSlug): void
    {
        $node = $this->live($nodeId);
        if ($node === null || ProjectArchivePaths::isUnder((string) $node->storage_key)) {
            return;
        }
        $disk = $this->storage->files();
        $toKey = ProjectArchivePaths::keyFor($teamSlug, $projectSlug);
        if (! $disk->directoryExists(dirname($toKey))) {
            $disk->makeDirectory(dirname($toKey));
        }
        if ($disk->exists($toKey)) {
            // A leftover of an earlier archive that failed half-way: never overwrite it.
            $toKey = $this->freeArchiveKey($toKey);
        }
        $this->moveTo((string) $node->storage_key, $toKey);
    }

    /** Unarchive: move the folder back next to the Team's other folders. A name taken meanwhile gets a suffix. */
    public function unarchive(string $nodeId, string $teamSlug, string $projectName): void
    {
        $node = $this->live($nodeId);
        if ($node === null || ! ProjectArchivePaths::isUnder((string) $node->storage_key)) {
            return;
        }
        $this->moveTo((string) $node->storage_key, $this->freeKey($teamSlug, self::folderName($projectName), null));
    }

    /** Purge: the folder goes to the Drive trash of the member who purged, where they can still restore files. */
    public function trashFor(string $nodeId, string $username): void
    {
        $node = $this->live($nodeId);
        if ($node !== null) {
            $this->relocator->trashForOwner($node, $username);
            $this->registry->forget();
        }
    }

    /** `/groups/{team}/{name}`, the virtual path the Drive app shows. */
    public static function virtualPath(JmapFileNode $node): string
    {
        return '/'.ltrim((string) $node->storage_key, '/');
    }

    /** A folder name from a Project name: no slashes, no leading dot (that would hide it), at most 120 characters. */
    public static function folderName(string $projectName): string
    {
        $name = trim(str_replace(['/', '\\', "\0"], '-', $projectName));
        $name = ltrim($name, '. ');
        $name = trim(Str::substr($name, 0, self::NAME_MAX_LENGTH));

        return $name !== '' ? $name : 'Project';
    }

    /** `groups/{team}/{name}`, or `{name} (2)`, `(3)` when taken. `$ownKey` is the folder's current key, which never counts as taken. */
    private function freeKey(string $teamSlug, string $name, ?string $ownKey): string
    {
        $disk = $this->storage->files();
        $base = 'groups/'.$teamSlug.'/';
        $candidate = $base.$name;
        for ($suffix = 2; $candidate !== $ownKey && $disk->exists($candidate); $suffix++) {
            $candidate = $base.$name.' ('.$suffix.')';
        }

        return $candidate;
    }
}
