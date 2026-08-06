<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Exceptions\ApiHttpException;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Search\SearchIndexerService;
use App\Storage\NoteScope;
use App\Storage\NoteStoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Database\QueryException;

final class NoteRepository
{
    public function __construct(
        private WgwStorage $storage,
        private NoteStoragePaths $notePaths,
        private NoteMarkdownCodec $codec,
        private SearchIndexerService $searchIndexer,
        private DriveGroupResolver $groups,
    ) {}

    /**
     * @param  array<string, mixed>  $params
     * @return array{items: list<array<string, mixed>>}
     */
    public function list(string $username, array $params): array
    {
        $archived = $this->codec->toBool($params['archived'] ?? null);
        $notebookFilter = isset($params['notebook']) && is_string($params['notebook'])
            ? trim($params['notebook'])
            : '';
        $q = isset($params['q']) && is_string($params['q']) ? strtolower(trim($params['q'])) : '';

        $items = [];
        foreach ($this->resolveListScopes($username, $params) as $scope) {
            foreach ($this->readAll($username, $scope) as $note) {
                if ($archived !== null && $note['archived'] !== $archived) {
                    continue;
                }
                if ($notebookFilter !== '' && $note['notebook'] !== $notebookFilter) {
                    continue;
                }
                if (
                    $q !== ''
                    && ! str_contains(strtolower((string) ($note['_searchTitle'] ?? '')), $q)
                    && ! str_contains(strtolower((string) $note['body']), $q)
                    && ! str_contains(strtolower(implode(',', $note['tags'])), $q)
                ) {
                    continue;
                }
                unset($note['_searchTitle']);
                $items[] = $note;
            }
        }

        usort(
            $items,
            static fn (array $a, array $b): int => strcmp((string) ($b['updatedAt'] ?? ''), (string) ($a['updatedAt'] ?? ''))
        );

        return ['items' => array_values($items)];
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true, item: array<string, mixed>}
     */
    public function upsert(string $username, ?string $pathId, array $body): array
    {
        $scope = $this->resolveScope($username, $body);
        $id = $pathId !== null
            ? $this->sanitizeNoteId($pathId)
            : $this->sanitizeNoteId((string) ($body['id'] ?? ('n'.(string) time())));
        $notebook = $this->sanitizeNotebook((string) ($body['notebook'] ?? 'General'));
        $archived = $this->codec->toBool($body['archived'] ?? false) ?? false;
        $tags = $this->codec->normalizeTags($body['tags'] ?? []);
        $starred = $this->codec->toBool($body['starred'] ?? null);
        $key = $this->notePaths->noteKey($scope, $notebook, $id, $archived);
        $disk = $this->disk();
        $title = $this->resolvePersistedTitle($scope, $id, $key);
        $disk->makeDirectory(dirname($key));

        // Body is optional: when the field is absent the markdown body section
        // on disk is preserved so metadata-only mutations never clobber a body
        // that may have been written through the collab persistence path. A
        // present-but-empty body (including '' normalized to null by the
        // ConvertEmptyStringsToNull middleware) still clears the body.
        if (array_key_exists('body', $body)) {
            $markdown = $this->codec->serialize($title, $tags, $starred, (string) ($body['body'] ?? ''));
        } else {
            $existing = $disk->exists($key) ? (string) $disk->get($key) : '';
            $markdown = $this->codec->withFrontmatter($existing, $title, $tags, $starred, $id);
        }

        if (! $disk->put($key, $markdown)) {
            throw new ApiHttpException(500, 'Could not save note.', 'server_error');
        }
        $this->syncSearchIndex(fn () => $this->searchIndexer->indexFileStorageKey($key));

        return [
            'ok' => true,
            'item' => $this->readAt($key, $username, $scope, $notebook, $id, $archived),
        ];
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true}
     */
    public function delete(string $username, string $id, array $body): array
    {
        $scope = $this->resolveScope($username, $body);
        $noteId = $this->sanitizeNoteId($id);
        $notebook = isset($body['notebook']) && is_string($body['notebook'])
            ? $this->sanitizeNotebook($body['notebook'])
            : null;
        $archived = $this->codec->toBool($body['archived'] ?? null);
        $location = $this->findNoteKey($scope, $noteId, $notebook, $archived);
        if ($location === null) {
            throw new ApiHttpException(400, 'Note not found.', 'bad_request');
        }
        if (! $this->disk()->delete($location['key'])) {
            throw new ApiHttpException(500, 'Could not delete note.', 'server_error');
        }
        $this->syncSearchIndex(fn () => $this->searchIndexer->deleteDavPath('files/'.$location['key']));

        return ['ok' => true];
    }

    /**
     * @return array{ok: true, item: array<string, mixed>}
     */
    public function setArchived(string $username, string $id, bool $toArchived, ?string $groupSlug = null): array
    {
        $scope = $this->resolveScope($username, ['groupSlug' => $groupSlug]);
        $noteId = $this->sanitizeNoteId($id);
        $from = $this->findNoteKey($scope, $noteId, null, ! $toArchived);
        if ($from === null) {
            throw new ApiHttpException(400, 'Note not found.', 'bad_request');
        }
        $toKey = $this->notePaths->noteKey($scope, $from['notebook'], $noteId, $toArchived);
        $disk = $this->disk();
        $disk->makeDirectory(dirname($toKey));
        if ($disk->exists($toKey)) {
            throw new ApiHttpException(400, 'Note already exists in target location.', 'bad_request');
        }
        if (! $disk->move($from['key'], $toKey)) {
            throw new ApiHttpException(500, 'Could not move note.', 'server_error');
        }
        $this->syncSearchIndex(fn () => $this->searchIndexer->deleteDavPath('files/'.$from['key']));
        $this->syncSearchIndex(fn () => $this->searchIndexer->indexFileStorageKey($toKey));

        return [
            'ok' => true,
            'item' => $this->readAt($toKey, $username, $scope, $from['notebook'], $noteId, $toArchived),
        ];
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array{items: list<array{name: string, activeCount: int, archivedCount: int, scope: string, groupSlug: string|null}>}
     */
    public function listNotebooks(string $username, array $params = []): array
    {
        $byName = [];
        foreach ($this->resolveListScopes($username, $params) as $scope) {
            foreach ($this->readAll($username, $scope) as $item) {
                $name = (string) ($item['notebook'] ?? '');
                if ($name === '') {
                    continue;
                }
                $scopeKey = $scope->type().':'.((string) $scope->groupSlug()).':'.$name;
                if (! isset($byName[$scopeKey])) {
                    $byName[$scopeKey] = [
                        'name' => $name,
                        'activeCount' => 0,
                        'archivedCount' => 0,
                        'scope' => $scope->isGroup() ? 'group' : 'personal',
                        'groupSlug' => $scope->groupSlug(),
                    ];
                }
                if (($item['archived'] ?? false) === true) {
                    $byName[$scopeKey]['archivedCount']++;
                } else {
                    $byName[$scopeKey]['activeCount']++;
                }
            }
        }
        ksort($byName);

        return ['items' => array_values($byName)];
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true, name: string}
     */
    public function createNotebook(string $username, array $body): array
    {
        $scope = $this->resolveScope($username, $body);
        $name = $this->sanitizeNotebook((string) ($body['name'] ?? ''));
        $key = $this->notePaths->notebookKey($scope, $name, false);
        if ($this->disk()->directoryExists($key)) {
            throw new ApiHttpException(400, 'Notebook already exists.', 'bad_request');
        }
        if (! $this->disk()->makeDirectory($key)) {
            throw new ApiHttpException(500, 'Could not create notebook.', 'server_error');
        }

        return ['ok' => true, 'name' => $name];
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true, from: string, to: string}
     */
    public function renameNotebook(string $username, string $name, array $body): array
    {
        $scope = $this->resolveScope($username, $body);
        $from = $this->sanitizeNotebook($name);
        $to = $this->sanitizeNotebook((string) ($body['name'] ?? ''));
        if ($from === $to) {
            return ['ok' => true, 'from' => $from, 'to' => $to];
        }
        foreach ([false, true] as $archived) {
            $source = $this->notePaths->notebookKey($scope, $from, $archived);
            $target = $this->notePaths->notebookKey($scope, $to, $archived);
            if (! $this->disk()->directoryExists($source)) {
                continue;
            }
            if ($this->disk()->directoryExists($target)) {
                throw new ApiHttpException(400, 'Destination notebook already exists.', 'bad_request');
            }
            $this->disk()->makeDirectory(dirname($target));
            if (! $this->disk()->move($source, $target)) {
                throw new ApiHttpException(500, 'Could not rename notebook.', 'server_error');
            }
        }

        return ['ok' => true, 'from' => $from, 'to' => $to];
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function deleteNotebook(string $username, string $name, array $body): array
    {
        $scope = $this->resolveScope($username, $body);
        $notebook = $this->sanitizeNotebook($name);
        $mode = isset($body['mode']) && is_string($body['mode']) ? strtolower(trim($body['mode'])) : 'archive';
        if (! in_array($mode, ['archive', 'move', 'purge'], true)) {
            throw new ApiHttpException(400, 'Invalid notebook delete mode.', 'bad_request');
        }
        if ($mode === 'move') {
            $target = $this->sanitizeNotebook((string) ($body['target'] ?? ''));
            if ($target === $notebook) {
                throw new ApiHttpException(400, 'Target notebook must be different.', 'bad_request');
            }
            foreach ([false, true] as $archived) {
                $sourceDir = $this->notePaths->notebookKey($scope, $notebook, $archived);
                if (! $this->disk()->directoryExists($sourceDir)) {
                    continue;
                }
                $targetDir = $this->notePaths->notebookKey($scope, $target, $archived);
                $this->disk()->makeDirectory($targetDir);
                $this->moveMarkdownFiles($sourceDir, $targetDir);
                $this->removeDirIfEmpty($sourceDir);
            }

            return ['ok' => true, 'mode' => 'move', 'target' => $target];
        }
        if ($mode === 'archive') {
            $sourceDir = $this->notePaths->notebookKey($scope, $notebook, false);
            if ($this->disk()->directoryExists($sourceDir)) {
                $archiveDir = $this->notePaths->notebookKey($scope, $notebook, true);
                $this->disk()->makeDirectory($archiveDir);
                $this->moveMarkdownFiles($sourceDir, $archiveDir);
                $this->removeDirIfEmpty($sourceDir);
            }

            return ['ok' => true, 'mode' => 'archive'];
        }

        foreach ([false, true] as $archived) {
            $this->removeNotebookCompletely($this->notePaths->notebookKey($scope, $notebook, $archived));
        }

        return ['ok' => true, 'mode' => 'purge'];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function readAll(string $username, NoteScope $scope): array
    {
        $out = [];
        foreach ([false, true] as $archived) {
            $base = $this->notePaths->baseKey($scope, $archived);
            if (! $this->disk()->directoryExists($base)) {
                continue;
            }
            foreach ($this->disk()->directories($base) as $notebookDir) {
                $notebook = basename($notebookDir);
                if (! $archived && $notebook === '.archive') {
                    continue;
                }
                foreach ($this->disk()->files($notebookDir) as $fileKey) {
                    $filename = basename($fileKey);
                    if (! $this->codec->isNoteFilename($filename)) {
                        continue;
                    }
                    $id = substr($filename, 0, -3);
                    if ($id === '') {
                        continue;
                    }
                    $out[] = $this->readAt($fileKey, $username, $scope, $notebook, $id, $archived);
                }
            }
        }

        return $out;
    }

    /**
     * @return array{key: string, notebook: string, archived: bool}|null
     */
    private function findNoteKey(NoteScope $scope, string $id, ?string $notebook, ?bool $archived): ?array
    {
        $candidates = [];
        $archivedOptions = $archived === null ? [false, true] : [$archived];
        foreach ($archivedOptions as $isArchived) {
            if ($notebook !== null) {
                $candidates[] = [
                    'key' => $this->notePaths->noteKey($scope, $notebook, $id, $isArchived),
                    'notebook' => $notebook,
                    'archived' => $isArchived,
                ];

                continue;
            }
            $base = $this->notePaths->baseKey($scope, $isArchived);
            if (! $this->disk()->directoryExists($base)) {
                continue;
            }
            foreach ($this->disk()->directories($base) as $notebookDir) {
                $entry = basename($notebookDir);
                if (! $isArchived && $entry === '.archive') {
                    continue;
                }
                $candidates[] = [
                    'key' => $this->notePaths->noteKey($scope, $entry, $id, $isArchived),
                    'notebook' => $entry,
                    'archived' => $isArchived,
                ];
            }
        }
        foreach ($candidates as $candidate) {
            if ($this->disk()->exists($candidate['key'])) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private function readAt(string $key, string $username, NoteScope $scope, string $notebook, string $id, bool $archived): array
    {
        $raw = $this->disk()->exists($key) ? (string) $this->disk()->get($key) : '';
        [$title, $tags, $starred, $body, $updated] = $this->codec->parse($raw, $id);
        $mtime = $this->disk()->exists($key) ? $this->disk()->lastModified($key) : time();

        // `updatedAt` reflects the note's *metadata* state, sourced from the
        // frontmatter `updated` marker that only metadata mutations bump. Body
        // edits flow through the collab path (`PUT /files/collaboration`) which
        // preserves the marker, so body saves do not advance `updatedAt` and
        // therefore never trip the offline metadata `ifInState` conflict guard.
        // Legacy notes without a marker fall back to the file mtime.
        //
        // `contentUpdatedAt` is the file mtime so clients can show “last edited”
        // (and list previews after refresh) when only the body changed.
        return [
            'id' => $id,
            'username' => $username,
            'notebook' => $notebook,
            'body' => $body,
            'tags' => $tags,
            'starred' => $starred,
            'archived' => $archived,
            'scope' => $scope->isGroup() ? 'group' : 'personal',
            'groupSlug' => $scope->groupSlug(),
            'updatedAt' => $updated ?? date('c', $mtime),
            'contentUpdatedAt' => date('c', $mtime),
            '_searchTitle' => $title,
        ];
    }

    /**
     * Scopes to enumerate for a list/notebooks call: a single requested group,
     * or the caller's personal tree plus every group they belong to.
     *
     * @param  array<string, mixed>  $params
     * @return list<NoteScope>
     */
    private function resolveListScopes(string $username, array $params): array
    {
        $slug = $this->requestedSlug($params);
        if ($slug !== null) {
            return [$this->groupScopeOrFail($username, $slug)];
        }
        $scopes = [NoteScope::personal($username)];
        foreach ($this->groups->allowedGroupSlugs($username) as $allowed) {
            $scopes[] = NoteScope::group($allowed);
        }

        return $scopes;
    }

    /**
     * Scope for a single mutation: personal by default, otherwise the requested
     * group (membership enforced).
     *
     * @param  array<string, mixed>  $source
     */
    private function resolveScope(string $username, array $source): NoteScope
    {
        $slug = $this->requestedSlug($source);
        if ($slug === null) {
            return NoteScope::personal($username);
        }

        return $this->groupScopeOrFail($username, $slug);
    }

    /**
     * @param  array<string, mixed>  $source
     */
    private function requestedSlug(array $source): ?string
    {
        if (! isset($source['groupSlug']) || ! is_string($source['groupSlug'])) {
            return null;
        }
        $slug = trim($source['groupSlug']);

        return $slug === '' ? null : $slug;
    }

    private function groupScopeOrFail(string $username, string $slug): NoteScope
    {
        if (preg_match('/^[A-Za-z0-9._-]{1,190}$/', $slug) !== 1) {
            throw new ApiHttpException(400, 'Invalid group.', 'bad_request');
        }
        if (! in_array($slug, $this->groups->allowedGroupSlugs($username), true)) {
            throw new ApiHttpException(403, 'Forbidden.', 'forbidden');
        }

        return NoteScope::group($slug);
    }

    private function resolvePersistedTitle(NoteScope $scope, string $id, string $targetKey): string
    {
        $disk = $this->disk();
        if ($disk->exists($targetKey)) {
            $raw = (string) $disk->get($targetKey);
            [$title] = $this->codec->parse($raw, $id);

            return $title !== '' ? $title : 'Untitled';
        }

        $existing = $this->findNoteKey($scope, $id, null, null);
        if ($existing !== null && $disk->exists($existing['key'])) {
            $raw = (string) $disk->get($existing['key']);
            [$title] = $this->codec->parse($raw, $id);

            return $title !== '' ? $title : 'Untitled';
        }

        return 'Untitled';
    }

    private function disk(): Filesystem
    {
        return $this->storage->notes();
    }

    private function sanitizeNoteId(string $id): string
    {
        $trimmed = trim($id);
        if ($trimmed === '' || preg_match('/^[A-Za-z0-9._-]{1,120}$/', $trimmed) !== 1) {
            throw new ApiHttpException(400, 'Invalid note id.', 'bad_request');
        }

        return $trimmed;
    }

    private function sanitizeNotebook(string $notebook): string
    {
        $trimmed = trim($notebook);
        if (
            $trimmed === ''
            || str_contains($trimmed, '/')
            || str_contains($trimmed, '\\')
            || str_contains($trimmed, "\0")
            || str_contains($trimmed, '..')
        ) {
            throw new ApiHttpException(400, 'Invalid notebook name.', 'bad_request');
        }

        return $trimmed;
    }

    private function moveMarkdownFiles(string $sourceDir, string $targetDir): void
    {
        foreach ($this->disk()->files($sourceDir) as $from) {
            $entry = basename($from);
            if (! $this->codec->isNoteFilename($entry)) {
                continue;
            }
            $to = $targetDir.'/'.$entry;
            if ($this->disk()->exists($to)) {
                throw new ApiHttpException(400, 'Target notebook already contains note '.$entry.'.', 'bad_request');
            }
            if (! $this->disk()->move($from, $to)) {
                throw new ApiHttpException(500, 'Could not move notebook notes.', 'server_error');
            }
            $this->syncSearchIndex(fn () => $this->searchIndexer->deleteDavPath('files/'.$from));
            $this->syncSearchIndex(fn () => $this->searchIndexer->indexFileStorageKey($to));
        }
    }

    private function removeDirIfEmpty(string $dir): void
    {
        if (! $this->disk()->directoryExists($dir)) {
            return;
        }
        if ($this->disk()->files($dir) !== [] || $this->disk()->directories($dir) !== []) {
            return;
        }
        $this->disk()->deleteDirectory($dir);
    }

    private function removeNotebookCompletely(string $dir): void
    {
        if (! $this->disk()->directoryExists($dir)) {
            return;
        }
        foreach ($this->disk()->files($dir) as $path) {
            if ($this->codec->isNoteFilename(basename($path))) {
                $this->disk()->delete($path);
                $this->syncSearchIndex(fn () => $this->searchIndexer->deleteDavPath('files/'.$path));
            }
        }
        $this->removeDirIfEmpty($dir);
    }

    /**
     * Keep notes APIs resilient when search index tables are unavailable.
     *
     * @param  callable(): void  $callback
     */
    private function syncSearchIndex(callable $callback): void
    {
        try {
            $callback();
        } catch (QueryException) {
            // Search index is optional in some test and bootstrap contexts.
        } catch (\Throwable) {
            // Search sync should never block note writes.
        }
    }
}
