<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\CalendarObject;
use App\Models\DriveShare;
use App\Models\DriveStarredItem;
use App\Models\GroupMember;
use App\Models\NoteStar;
use App\Models\Principal;
use App\Services\Notes\Conversion\NoteJournalConverter;
use App\Storage\WgwStorage;

/**
 * One-way import of Drive `.notes/*.md` files (v0.1.96 and older) into
 * VJOURNAL notebooks. Safe to run again: {@see LegacyNoteImportLedger} skips
 * files that already became a note. The source files stay on disk.
 */
final class NotesFileMigrator
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly NoteMarkdownCodec $codec,
        private readonly NotebookRepository $notebooks,
        private readonly NoteRepository $notes,
        private readonly LegacyNoteImportLedger $ledger,
        private readonly LegacyNoteFileLister $files,
    ) {}

    /**
     * Each file is imported on its own: a file that fails is skipped with a
     * notice and the next one is tried. A skipped file is not recorded, so
     * the next run (the command, or a later update) tries it again.
     *
     * @return array{
     *   mapped: int,
     *   imported: int,
     *   alreadyImported: int,
     *   starred: int,
     *   skipped: int,
     *   discardedYjs: int,
     *   images: int,
     *   notices: list<string>
     * }
     */
    public function migrate(bool $discardYjs = false): array
    {
        $result = [
            'mapped' => 0,
            'imported' => 0,
            'alreadyImported' => 0,
            'starred' => 0,
            'skipped' => 0,
            'discardedYjs' => 0,
            'images' => 0,
            'notices' => [],
        ];
        $files = $this->files->list($result['notices']);
        $pathToUid = $this->buildPathUidMap($files);
        $result['mapped'] = count($pathToUid);
        $stars = $this->driveStarsByPath();
        $shares = $this->sharedPaths();

        foreach ($pathToUid as $virtualPath => $uid) {
            try {
                $this->importFile($virtualPath, $uid, $stars, $shares, $result);
            } catch (\Throwable $exception) {
                $result['skipped']++;
                $result['notices'][] = 'import failed '.$virtualPath.': '.$exception->getMessage();
            }
        }

        if ($discardYjs) {
            $result['discardedYjs'] = $this->discardYjsSidecars($files);
        } else {
            foreach ($this->yjsSidecars($files) as $sidecar) {
                $result['notices'][] = 'collaborative edits not imported, kept on disk: /'.$sidecar;
            }
        }

        return $result;
    }

    /**
     * Stars are copied right before the path is recorded, so a run that stops
     * halfway loses none. A recorded path is left alone: an unstar sticks.
     *
     * @param  array<string, list<string>>  $stars
     * @param  list<string>  $shares
     * @param  array{mapped: int, imported: int, alreadyImported: int, starred: int, skipped: int, discardedYjs: int, images: int, notices: list<string>}  $result
     */
    private function importFile(string $virtualPath, string $uid, array $stars, array $shares, array &$result): void
    {
        if ($this->ledger->recordedUid($virtualPath) !== null) {
            $result['alreadyImported']++;

            return;
        }
        if ($this->ledger->noteExists($uid)) {
            // A run that stopped between creating the note and recording it.
            $result['starred'] += $this->copyStars($virtualPath, $uid, $stars);
            $this->ledger->record($virtualPath, $uid);
            $result['alreadyImported']++;

            return;
        }

        $parsed = $this->parseNotePath($virtualPath);
        if ($parsed === null) {
            $result['skipped']++;
            $result['notices'][] = 'unparsed path: '.$virtualPath;

            return;
        }
        $markdown = (string) $this->storage->files()->get(ltrim($virtualPath, '/'));
        $fallback = pathinfo($parsed['filename'], PATHINFO_FILENAME);
        [$title, $tags, $body] = $this->codec->parse($markdown, $fallback);
        if ($this->codec->isPlaceholderTitle($title, $fallback)) {
            $title = '';
        }
        if (strlen($body) > NoteJournalConverter::MAX_MARKDOWN_BYTES) {
            $result['skipped']++;
            $result['notices'][] = 'over-limit skipped: '.$virtualPath;

            return;
        }
        $imageCount = $this->countMarkdownImages($body);
        if ($imageCount > 0) {
            $result['images'] += $imageCount;
            $result['notices'][] = sprintf('images=%d uid=%s path=%s', $imageCount, $uid, $virtualPath);
        }

        $username = $parsed['scope'] === 'group' ? $this->groupOwnerUsername($parsed['owner']) : $parsed['owner'];
        if ($username === null) {
            $result['skipped']++;
            $result['notices'][] = 'no owner for: '.$virtualPath;

            return;
        }

        $groupSlug = $parsed['scope'] === 'group' ? $parsed['owner'] : null;
        $notebook = $this->notebooks->findOrCreateNamed($username, $parsed['notebook'], $groupSlug);
        $calendarId = $this->notebooks->findAccessibleNotebook($username, (string) $notebook['id'])?->calendarid;
        $earlier = $calendarId !== null ? $this->ledger->claimEarlierImport((int) $calendarId, $title, $body) : null;
        if ($earlier !== null) {
            $this->ledger->record($virtualPath, $earlier);
            $result['alreadyImported']++;

            return;
        }

        $note = $this->notes->create($username, [
            'uid' => $uid,
            'notebookId' => $notebook['id'],
            'title' => $title !== '' ? $title : null,
            'body' => $body,
            'categories' => $tags,
            'status' => $parsed['archived'] ? 'CANCELLED' : null,
        ], allowStoredTags: true);
        $noteUid = is_string($note['id'] ?? null) ? (string) $note['id'] : $uid;
        $result['starred'] += $this->copyStars($virtualPath, $noteUid, $stars);
        $this->ledger->record($virtualPath, $noteUid);
        $result['imported']++;
        foreach ($shares as $shared) {
            if ($virtualPath === $shared || str_starts_with($virtualPath, $shared.'/')) {
                $result['notices'][] = sprintf('shared in Drive as %s; the imported note is not shared: %s', $shared, $virtualPath);
            }
        }
    }

    /**
     * Build old virtual path → new UID first (stars join this map).
     *
     * @param  list<string>  $files
     * @return array<string, string>
     */
    public function buildPathUidMap(array $files): array
    {
        $map = [];
        foreach ($files as $key) {
            $key = ltrim(str_replace('\\', '/', (string) $key), '/');
            if (! str_ends_with(strtolower($key), '.md')) {
                continue;
            }
            if (! preg_match('#^(?:users|groups)/[^/]+/\.notes/#', $key)) {
                continue;
            }
            if (str_starts_with(basename($key), '._')) {
                continue;
            }
            $map['/'.$key] = $this->ledger->uidFor('/'.$key);
        }

        return $map;
    }

    /**
     * @return array{scope: 'personal'|'group', owner: string, notebook: string, filename: string, archived: bool}|null
     */
    public function parseNotePath(string $virtualPath): ?array
    {
        $normalized = '/'.ltrim(str_replace('\\', '/', $virtualPath), '/');
        if (preg_match('#^/(users|groups)/([^/]+)/\.notes/(?:\.archive/)?([^/]+)/([^/]+\.md)$#i', $normalized, $m) !== 1) {
            return null;
        }
        $notebook = $m[3];
        if (strcasecmp($notebook, '.archive') === 0) {
            return null;
        }

        return [
            'scope' => $m[1] === 'groups' ? 'group' : 'personal',
            'owner' => $m[2],
            'notebook' => $notebook,
            'filename' => $m[4],
            'archived' => str_contains($normalized, '/.notes/.archive/'),
        ];
    }

    public function countMarkdownImages(string $body): int
    {
        preg_match_all('/!\[[^\]]*\]\([^)]+\)/', $body, $matches);

        return count($matches[0]);
    }

    /**
     * @param  array<string, list<string>>  $stars
     */
    private function copyStars(string $virtualPath, string $uid, array $stars): int
    {
        $usernames = $stars[$virtualPath] ?? [];
        if ($usernames === []) {
            return 0;
        }
        $objectId = CalendarObject::query()->where('uid', $uid)->value('id');
        if ($objectId === null) {
            return 0;
        }
        foreach ($usernames as $username) {
            NoteStar::query()->firstOrCreate([
                'username' => $username,
                'calendar_object_id' => (int) $objectId,
            ], [
                'note_uid' => $uid,
            ]);
        }

        return count($usernames);
    }

    /**
     * @return array<string, list<string>> virtual path → usernames who starred it
     */
    private function driveStarsByPath(): array
    {
        $stars = [];
        foreach (DriveStarredItem::query()->where('path', 'like', '%/.notes/%')->get(['username', 'path']) as $row) {
            $path = '/'.ltrim((string) $row->path, '/');
            $stars[$path][] = (string) $row->username;
        }

        return $stars;
    }

    /**
     * Drive shares on a `.notes` file or folder do not carry over to Notes
     * (#668); the update log names the notes they covered.
     *
     * @return list<string>
     */
    private function sharedPaths(): array
    {
        $paths = DriveShare::query()
            ->whereNull('revoked_at')
            ->where('path', 'like', '%/.notes%')
            ->pluck('path')
            ->map(fn ($path): string => rtrim('/'.ltrim((string) $path, '/'), '/'))
            ->all();

        return array_values(array_unique($paths));
    }

    /**
     * @param  list<string>  $files
     */
    private function discardYjsSidecars(array $files): int
    {
        $disk = $this->storage->files();
        $discarded = 0;
        foreach ($this->yjsSidecars($files) as $key) {
            if ($disk->fileExists($key)) {
                $disk->delete($key);
                $discarded++;
            }
        }

        return $discarded;
    }

    /**
     * @param  list<string>  $files
     * @return list<string>
     */
    private function yjsSidecars(array $files): array
    {
        $sidecars = [];
        foreach ($files as $key) {
            $key = ltrim(str_replace('\\', '/', (string) $key), '/');
            if (str_ends_with($key, '.md.yjs') && str_contains($key, '/.notes/')) {
                $sidecars[] = $key;
            }
        }

        return $sidecars;
    }

    private function groupOwnerUsername(string $groupSlug): ?string
    {
        $group = Principal::query()
            ->where('uri', 'principals/groups/'.$groupSlug)
            ->first();
        if ($group === null) {
            return null;
        }
        $member = GroupMember::query()
            ->where('principal_id', (int) $group->id)
            ->orderBy('id')
            ->first();
        $uri = (string) ($member?->member->uri ?? '');
        if (str_starts_with($uri, 'principals/') && ! str_starts_with($uri, 'principals/groups/')) {
            return substr($uri, strlen('principals/'));
        }

        return null;
    }
}
