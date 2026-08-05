<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\Principal;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Search\SearchIndexerService;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use App\Support\WgwSettings;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class DriveService
{
    public function __construct(
        private WgwStorage $storage,
        private StoragePaths $paths,
        private DriveGroupResolver $groups,
        private DriveShareAuthorizer $authorizer,
        private DriveShareService $shares,
        private DriveSessionStore $session,
        private DriveStarService $stars,
        private AdminRoleResolver $adminRoles,
        private SearchIndexerService $search,
    ) {}

    public function assertFilesEnabled(): void
    {
        $cfg = WgwSettings::normalized();
        if (! (bool) ($cfg[WgwSettings::FILES_ENABLED] ?? true)) {
            throw new \RuntimeException('WebDAV files are disabled for this site.');
        }
    }

    /**
     * @return array{username: string, name: string, role: string, roots: list<string>}
     */
    public function userContext(string $username): array
    {
        $this->assertFilesEnabled();
        $principal = Principal::query()->where('uri', 'principals/'.$username)->first();

        return [
            'username' => $username,
            'name' => (string) ($principal?->displayname ?: $username),
            'role' => $this->adminRoles->isAdmin($username) ? 'admin' : 'user',
            'roots' => ['/users', '/groups'],
        ];
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array{location: string, files: list<array<string, mixed>>}
     */
    public function listDirectory(array $principal, string $dir): array
    {
        $this->assertFilesEnabled();
        $dir = $this->paths->normalizeVirtualPath($dir);
        $listingContext = $this->authorizer->listingRightsContext($principal, $dir);
        if (! $listingContext->rightsFor($dir)['mayView']) {
            throw new \InvalidArgumentException('Access denied for this path.');
        }
        $this->session->setCwd($dir);

        return [
            'location' => $this->withTrailingSlash($dir),
            'files' => $this->listEntries($dir, $principal, false, null, $listingContext),
        ];
    }

    /**
     * @return array{location: string, files: list<array{type: string, path: string, name: string, size: int, time: int, permissions: int}>}
     */
    public function search(string $username, string $query, int $limit): array
    {
        $this->assertFilesEnabled();
        $principal = [
            'username' => $username,
            'role' => $this->adminRoles->isAdmin($username) ? 'admin' : 'user',
        ];
        $query = trim($query);
        if ($query === '' || mb_strlen($query) < 2) {
            return ['location' => '/', 'files' => []];
        }

        return [
            'location' => '/',
            'files' => array_slice(
                $this->listEntries('/', $principal, true, $query),
                0,
                max(1, min(100, $limit))
            ),
        ];
    }

    /**
     * @return array{cwd: string}
     */
    public function changeDirectory(string $username, string $to): array
    {
        $this->assertFilesEnabled();
        $groupSlugs = $this->groups->allowedGroupSlugs($username);
        $to = $this->paths->normalizeVirtualPath($to);
        if (! $this->paths->isPathAllowed($to, $username, $groupSlugs, false)) {
            $to = '/';
        }
        $this->session->setCwd($to);

        return ['cwd' => $to];
    }

    public function createItem(
        array $principal,
        string $name,
        string $type,
        ?string $cwd,
    ): string {
        $this->assertFilesEnabled();
        $username = $principal['username'];
        $groupSlugs = $this->groups->allowedGroupSlugs($username);
        $name = $this->validateItemName($name);
        if ($type !== 'dir' && $type !== 'file') {
            throw new \InvalidArgumentException('Invalid item type. Use "dir" or "file".');
        }

        $parent = $this->resolveParentPath($cwd, $principal, $username, $groupSlugs);
        $this->assertExplicitParentAllowed($parent, $principal);
        $newPath = $this->paths->normalizeVirtualPath($parent.'/'.$name);
        $this->authorizer->assertMayManageStructure($newPath, $principal);

        $disk = $this->disk();
        $key = $this->paths->virtualToStorageKey($newPath);
        if ($type === 'dir') {
            if ($disk->directoryExists($key)) {
                throw new \InvalidArgumentException('Item already exists.');
            }
            $disk->makeDirectory($key);
        } else {
            if ($disk->fileExists($key)) {
                throw new \InvalidArgumentException('Item already exists.');
            }
            $disk->put($key, '');
        }
        $this->search->indexFileStorageKey($key);

        return 'Created';
    }

    public function renameItem(
        array $principal,
        string $destination,
        string $from,
        string $toName,
    ): string {
        $this->assertFilesEnabled();
        $destination = $this->paths->normalizeVirtualPath($destination);
        $toName = $this->validateItemName($toName);
        $fromPath = str_contains($from, '/')
            ? $this->paths->normalizeVirtualPath($from)
            : $this->paths->normalizeVirtualPath($destination.'/'.$this->validateItemName($from));
        $toPath = $this->paths->normalizeVirtualPath($destination.'/'.$toName);

        $this->authorizer->assertMoveWithinScope($fromPath, $toPath, $principal);

        $disk = $this->disk();
        $fromKey = $this->paths->virtualToStorageKey($fromPath);
        $toKey = $this->paths->virtualToStorageKey($toPath);
        if (! $disk->exists($fromKey)) {
            throw new \InvalidArgumentException('Source not found.');
        }
        if ($disk->exists($toKey)) {
            if ($this->isTrashDestination($destination)) {
                $toName = $this->resolveUniqueTrashName($disk, $destination, $toName);
                $toPath = $this->paths->normalizeVirtualPath($destination.'/'.$toName);
                $toKey = $this->paths->virtualToStorageKey($toPath);
            } else {
                throw new \InvalidArgumentException('Destination already exists.');
            }
        }
        if (! $disk->move($fromKey, $toKey)) {
            throw new \RuntimeException('Rename failed.');
        }
        $this->search->deleteDavPath('files/'.$fromKey);
        $this->search->indexFileStorageKey($toKey);
        if ($disk->directoryExists($toKey)) {
            $this->reindexSubtree($toKey);
        }

        return 'Renamed';
    }

    /**
     * @param  list<array{path?: string, type?: string}>  $items
     */
    public function deleteItems(array $principal, array $items): string
    {
        $this->assertFilesEnabled();
        $disk = $this->disk();

        foreach ($items as $item) {
            if (! is_array($item)) {
                continue;
            }
            $path = $this->paths->normalizeVirtualPath((string) ($item['path'] ?? '/'));
            $this->authorizer->assertMayManageStructure($path, $principal);
            $key = $this->paths->virtualToStorageKey($path);
            if ($disk->directoryExists($key)) {
                $disk->deleteDirectory($key);
                $this->search->deleteDavPath('files/'.$key);
            } elseif ($disk->exists($key)) {
                $disk->delete($key);
                $this->search->deleteDavPath('files/'.$key);
            }
        }

        return 'Deleted';
    }

    /**
     * @param  list<string>  $groupSlugs
     * @return list<string>
     */
    public function listStarredPaths(string $username, array $groupSlugs): array
    {
        $this->assertFilesEnabled();

        return $this->stars->listPaths($username, $groupSlugs);
    }

    public function updateStar(string $username, string $path, bool $starred): string
    {
        $this->assertFilesEnabled();
        $groupSlugs = $this->groups->allowedGroupSlugs($username);
        $path = $this->paths->normalizeVirtualPath($path);
        if (! $this->paths->isPathAllowed($path, $username, $groupSlugs, false)) {
            throw new \InvalidArgumentException('Access denied for this path.');
        }
        $this->stars->setStarred($username, $path, $starred);

        return 'Updated';
    }

    public function downloadResponse(array $principal, string $path): StreamedResponse
    {
        $this->assertFilesEnabled();
        $virtual = $this->paths->normalizeVirtualPath($path);
        $this->authorizer->assertMayRead($virtual, $principal);

        $disk = $this->disk();
        $key = $this->paths->virtualToStorageKey($virtual);
        if (! $disk->fileExists($key)) {
            throw new \InvalidArgumentException('File not found.');
        }

        $name = basename($virtual);
        $mime = $disk->mimeType($key) ?: 'application/octet-stream';

        return response()->streamDownload(
            static function () use ($disk, $key): void {
                $stream = $disk->readStream($key);
                if (! is_resource($stream)) {
                    return;
                }
                fpassthru($stream);
                fclose($stream);
            },
            $name,
            [
                'Content-Type' => $mime,
                'Content-Disposition' => 'inline; filename="'.str_replace('"', '', $name).'"',
            ]
        );
    }

    public function handleUpload(
        array $principal,
        UploadedFile $file,
        string $filename,
        string $identifier,
        int $chunkNumber,
        int $totalChunks,
        ?string $cwd,
    ): string {
        $this->assertFilesEnabled();
        $username = $principal['username'];
        $groupSlugs = $this->groups->allowedGroupSlugs($username);
        $filename = $this->validateItemName($filename);
        $identifier = preg_replace('/[^0-9A-Za-z_]/', '_', $identifier) ?? '';
        $chunkNumber = max(1, $chunkNumber);
        $totalChunks = max(1, $totalChunks);

        $parent = $this->resolveParentPath($cwd, $principal, $username, $groupSlugs);
        $targetVirtual = $this->paths->normalizeVirtualPath($parent.'/'.$filename);
        $disk = $this->disk();
        $targetKey = $this->paths->virtualToStorageKey($targetVirtual);
        if ($disk->fileExists($targetKey)) {
            $this->authorizer->assertMayEditContent($targetVirtual, $principal);
        } else {
            $this->authorizer->assertMayManageStructure($targetVirtual, $principal);
        }

        if ($totalChunks <= 1) {
            $disk->put($targetKey, $file->get());
            $this->search->indexFileStorageKey($targetKey);

            return 'Stored';
        }

        $tempDisk = $this->storage->data();
        $partKey = 'drive-upload-temp/'.hash('sha256', $identifier.'|'.$filename.'|'.$targetVirtual).'.part';
        $chunk = $file->get();
        if ($chunkNumber === 1) {
            $tempDisk->put($partKey, $chunk);
        } else {
            $existing = $tempDisk->exists($partKey) ? $tempDisk->get($partKey) : '';
            $tempDisk->put($partKey, $existing.$chunk);
        }

        if ($chunkNumber < $totalChunks) {
            return 'Uploaded';
        }

        $disk->put($targetKey, $tempDisk->get($partKey));
        $tempDisk->delete($partKey);
        $this->search->indexFileStorageKey($targetKey);

        return 'Stored';
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return list<array<string, mixed>>
     */
    private function listEntries(
        string $virtualDir,
        array $principal,
        bool $recursive,
        ?string $nameQuery,
        ?DriveShareListingRightsContext $listingContext = null,
    ): array {
        $disk = $this->disk();
        $query = $nameQuery !== null ? mb_strtolower($nameQuery) : null;

        if ($virtualDir === '/' && ! $recursive) {
            $out = [];
            foreach (['/users', '/groups'] as $root) {
                try {
                    $this->authorizer->assertMayRead($root, $principal);
                } catch (\InvalidArgumentException) {
                    continue;
                }
                $key = ltrim($root, '/');
                if (! $disk->directoryExists($key)) {
                    continue;
                }
                $out[] = $this->serializeEntry($root, true, 0, (int) ($disk->lastModified($key) ?? time()), $principal);
            }

            return $this->annotateHasShares($principal, $this->sortEntries($out));
        }

        $prefix = $this->paths->virtualToStorageKey($virtualDir);
        if ($prefix !== '' && ! $disk->directoryExists($prefix)) {
            return [];
        }

        if ($recursive) {
            return $this->searchRecursive($disk, $principal, $query);
        }

        $out = [];
        $listingContext ??= $this->listingRightsContext($principal, $virtualDir);
        $dirPrefix = $prefix === '' ? '' : rtrim($prefix, '/').'/';
        foreach ($disk->directories($prefix) as $dirKey) {
            $virt = $this->paths->normalizeVirtualPath('/'.$dirKey);
            if (! $this->mayIncludeInListing($virt, $principal, $listingContext)) {
                continue;
            }
            if ($this->isHiddenNotesPath($virt)) {
                continue;
            }
            $out[] = $this->serializeEntry($virt, true, 0, (int) ($disk->lastModified($dirKey) ?? time()), $principal, $listingContext);
        }
        foreach ($disk->files($prefix) as $fileKey) {
            $virt = $this->paths->normalizeVirtualPath('/'.$fileKey);
            if (! $this->mayIncludeInListing($virt, $principal, $listingContext)) {
                continue;
            }
            if ($this->isHiddenNotesPath($virt)) {
                continue;
            }
            $out[] = $this->serializeEntry(
                $virt,
                false,
                (int) ($disk->size($fileKey) ?? 0),
                (int) ($disk->lastModified($fileKey) ?? time()),
                $principal,
                $listingContext,
            );
        }

        return $this->annotateHasShares($principal, $this->sortEntries($out));
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @param  list<array<string, mixed>>  $entries
     * @return list<array<string, mixed>>
     */
    private function annotateHasShares(array $principal, array $entries): array
    {
        if (($principal['role'] ?? '') === 'guest' || $entries === []) {
            return $entries;
        }

        $paths = array_map(static fn (array $entry): string => (string) $entry['path'], $entries);
        $indicators = $this->shares->shareIndicatorsForPaths($principal['username'], $paths);
        if ($indicators === []) {
            return $entries;
        }

        foreach ($entries as &$entry) {
            $path = $this->paths->normalizeVirtualPath((string) $entry['path']);
            $flags = $indicators[$path] ?? null;
            if ($flags === null) {
                continue;
            }
            if ($flags['hasPublicShare']) {
                $entry['hasPublicShare'] = true;
            }
            if ($flags['hasTeamShare']) {
                $entry['hasTeamShare'] = true;
            }
            if ($flags['hasPublicShare'] || $flags['hasTeamShare']) {
                $entry['hasShares'] = true;
            }
        }
        unset($entry);

        return $entries;
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return list<array<string, mixed>>
     */
    private function searchRecursive(
        Filesystem $disk,
        array $principal,
        ?string $query,
    ): array {
        $out = [];
        foreach ($disk->allFiles() as $fileKey) {
            $virt = $this->paths->normalizeVirtualPath('/'.$fileKey);
            try {
                $this->authorizer->assertMayRead($virt, $principal);
            } catch (\InvalidArgumentException) {
                continue;
            }
            if ($this->isHiddenNotesPath($virt)) {
                continue;
            }
            $name = basename($virt);
            if ($query !== null && ! str_contains(mb_strtolower($name), $query)) {
                continue;
            }
            $isDir = false;
            $out[] = $this->serializeEntry(
                $virt,
                $isDir,
                (int) ($disk->size($fileKey) ?? 0),
                (int) ($disk->lastModified($fileKey) ?? time()),
                $principal,
            );
            if (count($out) >= 400) {
                break;
            }
        }

        foreach ($disk->allDirectories() as $dirKey) {
            $virt = $this->paths->normalizeVirtualPath('/'.$dirKey);
            try {
                $this->authorizer->assertMayRead($virt, $principal);
            } catch (\InvalidArgumentException) {
                continue;
            }
            if ($this->isHiddenNotesPath($virt)) {
                continue;
            }
            $name = basename($virt);
            if ($query !== null && ! str_contains(mb_strtolower($name), $query)) {
                continue;
            }
            $out[] = $this->serializeEntry($virt, true, 0, (int) ($disk->lastModified($dirKey) ?? time()), $principal);
            if (count($out) >= 400) {
                break;
            }
        }

        if ($query !== null) {
            usort(
                $out,
                static function (array $a, array $b) use ($query): int {
                    $ap = str_starts_with(mb_strtolower($a['name']), $query) ? 0 : 1;
                    $bp = str_starts_with(mb_strtolower($b['name']), $query) ? 0 : 1;
                    if ($ap !== $bp) {
                        return $ap <=> $bp;
                    }
                    if ($a['type'] !== $b['type']) {
                        return $a['type'] === 'dir' ? -1 : 1;
                    }

                    return strnatcasecmp($a['name'], $b['name']);
                }
            );
        }

        return $out;
    }

    /**
     * @param  list<array{type: string, path: string, name: string, size: int, time: int, permissions: int}>  $entries
     * @return list<array{type: string, path: string, name: string, size: int, time: int, permissions: int}>
     */
    private function sortEntries(array $entries): array
    {
        usort(
            $entries,
            static function (array $a, array $b): int {
                if ($a['type'] !== $b['type']) {
                    return $a['type'] === 'dir' ? -1 : 1;
                }

                return strnatcasecmp($a['name'], $b['name']);
            }
        );

        return $entries;
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array<string, mixed>
     */
    private function serializeEntry(
        string $virtualPath,
        bool $isDir,
        int $size,
        int $time,
        array $principal,
        ?DriveShareListingRightsContext $listingContext = null,
    ): array {
        $path = $this->paths->normalizeVirtualPath($virtualPath);
        $rights = $listingContext !== null
            ? $listingContext->rightsFor($path)
            : $this->authorizer->effectiveRights($path, $principal);

        return [
            'type' => $isDir ? 'dir' : 'file',
            'path' => $path,
            'name' => basename($path),
            'size' => max(0, $size),
            'time' => max(0, $time),
            'permissions' => 0,
            'myRights' => $rights,
        ];
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    private function mayIncludeInListing(
        string $virtualPath,
        array $principal,
        ?DriveShareListingRightsContext $listingContext,
    ): bool {
        if ($listingContext !== null) {
            return $listingContext->rightsFor($virtualPath)['mayView'];
        }

        try {
            $this->authorizer->assertMayRead($virtualPath, $principal);
        } catch (\InvalidArgumentException) {
            return false;
        }

        return true;
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    private function listingRightsContext(array $principal, string $virtualDir): ?DriveShareListingRightsContext
    {
        if ($virtualDir === '/') {
            return null;
        }

        return $this->authorizer->listingRightsContext($principal, $virtualDir);
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    private function assertExplicitParentAllowed(?string $cwd, array $principal): void
    {
        if ($cwd === null || trim($cwd) === '') {
            return;
        }

        $requested = $this->paths->normalizeVirtualPath($cwd);
        $this->authorizer->assertMayManageStructure($requested, $principal);
    }

    private function requireGuestParentPath(?string $cwd): string
    {
        if ($cwd === null || trim($cwd) === '') {
            throw new \InvalidArgumentException('Missing path query parameter.');
        }

        return $this->paths->normalizeVirtualPath($cwd);
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @param  list<string>  $groupSlugs
     */
    private function resolveParentPath(?string $cwd, array $principal, string $username, array $groupSlugs): string
    {
        if ($cwd !== null && trim($cwd) !== '') {
            return $this->paths->normalizeVirtualPath($cwd);
        }

        if ($principal['role'] === 'guest') {
            throw new \InvalidArgumentException('Missing path query parameter.');
        }

        return $this->session->resolveCwd($cwd, $username, $groupSlugs);
    }

    private function validateItemName(string $name): string
    {
        $name = trim($name);
        if (
            $name === ''
            || $name === '.'
            || $name === '..'
            || str_contains($name, '/')
            || str_contains($name, '\\')
            || str_contains($name, "\0")
        ) {
            throw new \InvalidArgumentException('Invalid item name.');
        }

        return $name;
    }

    private function withTrailingSlash(string $virtualPath): string
    {
        $path = $this->paths->normalizeVirtualPath($virtualPath);

        return $path === '/' ? '/' : $path.'/';
    }

    private function isHiddenNotesPath(string $virtualPath): bool
    {
        return preg_match('#/(?:users|groups)/[^/]+/\.notes(?:/|$)#', $virtualPath) === 1;
    }

    private function isTrashDestination(string $destination): bool
    {
        return preg_match('#/\.Trash$#', $destination) === 1
            || preg_match('#/Trash$#', $destination) === 1;
    }

    private function resolveUniqueTrashName(Filesystem $disk, string $trashVirtualPath, string $name): string
    {
        $name = $this->validateItemName($name);
        $prefix = $this->paths->virtualToStorageKey($trashVirtualPath);
        $taken = [];
        foreach ($disk->files($prefix) as $key) {
            $taken[] = basename($key);
        }
        foreach ($disk->directories($prefix) as $key) {
            $taken[] = basename($key);
        }
        $takenLower = array_map(static fn (string $entry): string => mb_strtolower($entry), $taken);

        $dot = strrpos($name, '.');
        $hasExt = $dot !== false && $dot > 0;
        $base = $hasExt ? substr($name, 0, $dot) : $name;
        $ext = $hasExt ? substr($name, $dot) : '';

        $candidate = $name;
        $index = 2;
        while (in_array(mb_strtolower($candidate), $takenLower, true)) {
            $candidate = $base.' '.$index.$ext;
            $index++;
        }

        return $candidate;
    }

    private function disk(): Filesystem
    {
        return $this->storage->files();
    }

    private function reindexSubtree(string $prefix): void
    {
        $disk = $this->disk();
        foreach ($disk->allDirectories($prefix) as $dirKey) {
            $this->search->indexFileStorageKey($dirKey);
        }
        foreach ($disk->allFiles($prefix) as $fileKey) {
            $this->search->indexFileStorageKey($fileKey);
        }
    }
}
