<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\CalendarObject;
use App\Models\DriveStarredItem;
use App\Models\GroupMember;
use App\Models\NoteStar;
use App\Models\Principal;
use App\Services\Notes\Conversion\NoteJournalConverter;
use App\Services\Search\SearchIndexerService;
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
        private readonly SearchIndexerService $search,
        private readonly LegacyNoteImportLedger $ledger,
    ) {}

    /**
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
    public function migrate(bool $discardYjs = true): array
    {
        $disk = $this->storage->files();
        $files = $this->legacyNoteFiles();
        $pathToUid = $this->buildPathUidMap($files);
        $created = [];
        $alreadyImported = 0;
        $imported = 0;
        $skipped = 0;
        $starred = 0;
        $images = 0;
        $discardedYjs = 0;
        $notices = [];

        foreach ($pathToUid as $virtualPath => $uid) {
            $earlier = $this->ledger->importedUid($virtualPath);
            if ($earlier !== null) {
                $pathToUid[$virtualPath] = $earlier;
                $alreadyImported++;

                continue;
            }
            $key = ltrim($virtualPath, '/');
            if (! $disk->fileExists($key)) {
                $skipped++;
                $notices[] = 'missing file: '.$virtualPath;

                continue;
            }
            $markdown = (string) $disk->get($key);
            $parsed = $this->parseNotePath($virtualPath);
            if ($parsed === null) {
                $skipped++;
                $notices[] = 'unparsed path: '.$virtualPath;

                continue;
            }

            $fallback = pathinfo($parsed['filename'], PATHINFO_FILENAME);
            [$title, $tags, $body] = $this->codec->parse($markdown, $fallback);
            if ($this->codec->isPlaceholderTitle($title, $fallback)) {
                $title = '';
            }
            if (strlen($body) > NoteJournalConverter::MAX_MARKDOWN_BYTES) {
                $skipped++;
                $notices[] = 'over-limit skipped: '.$virtualPath;

                continue;
            }

            $imageCount = $this->countMarkdownImages($body);
            if ($imageCount > 0) {
                $images += $imageCount;
                $notices[] = sprintf('images=%d uid=%s path=%s', $imageCount, $uid, $virtualPath);
            }

            $username = $parsed['scope'] === 'group' ? $this->groupOwnerUsername($parsed['owner']) : $parsed['owner'];
            if ($username === null) {
                $skipped++;
                $notices[] = 'no owner for: '.$virtualPath;

                continue;
            }

            $notebookName = $parsed['notebook'] !== '' ? $parsed['notebook'] : 'General';
            $groupSlug = $parsed['scope'] === 'group' ? $parsed['owner'] : null;
            $notebook = $this->notebooks->findOrCreateNamed($username, $notebookName, $groupSlug);
            $calendarId = $this->notebooks->findAccessibleNotebook($username, (string) $notebook['id'])?->calendarid;
            $earlier = $calendarId !== null ? $this->ledger->claimEarlierImport((int) $calendarId, $title, $body) : null;
            if ($earlier !== null) {
                $this->ledger->record($virtualPath, $earlier);
                $pathToUid[$virtualPath] = $earlier;
                $alreadyImported++;

                continue;
            }

            try {
                $note = $this->notes->create($username, [
                    'uid' => $uid,
                    'notebookId' => $notebook['id'],
                    'title' => $title !== '' ? $title : null,
                    'body' => $body,
                    'categories' => $tags,
                    'status' => $parsed['archived'] ? 'CANCELLED' : null,
                ], allowStoredTags: true);
                $pathToUid[$virtualPath] = is_string($note['id'] ?? null) ? (string) $note['id'] : $uid;
                $this->ledger->record($virtualPath, $pathToUid[$virtualPath]);
                $created[] = $pathToUid[$virtualPath];
                $imported++;
            } catch (\Throwable $exception) {
                $skipped++;
                $notices[] = 'import failed '.$virtualPath.': '.$exception->getMessage();
            }
        }

        $starred = $this->backfillStars($pathToUid, array_flip($created), $notices);
        $discardedYjs = $discardYjs ? $this->discardYjsSidecars($files) : 0;
        if (! $discardYjs) {
            foreach ($this->yjsSidecars($files) as $sidecar) {
                $notices[] = 'collaborative edits not imported, kept on disk: /'.$sidecar;
            }
        }
        $this->reindexImported($created);

        return [
            'mapped' => count($pathToUid),
            'imported' => $imported,
            'alreadyImported' => $alreadyImported,
            'starred' => $starred,
            'skipped' => $skipped,
            'discardedYjs' => $discardedYjs,
            'images' => $images,
            'notices' => $notices,
        ];
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
     * Stars only notes this run created: an earlier run already starred the
     * others, and someone may have unstarred them since.
     *
     * @param  array<string, string>  $pathToUid
     * @param  array<string, int>  $createdUids
     * @param  list<string>  $notices
     */
    private function backfillStars(array $pathToUid, array $createdUids, array &$notices): int
    {
        $count = 0;
        foreach (DriveStarredItem::query()->get() as $row) {
            $path = (string) $row->path;
            $normalized = str_starts_with($path, '/') ? $path : '/'.$path;
            $uid = $pathToUid[$normalized] ?? null;
            if ($uid === null) {
                if (str_contains($normalized, '/.notes/')) {
                    $notices[] = 'star skip (path not in map): '.$normalized;
                }

                continue;
            }
            if (! isset($createdUids[$uid])) {
                continue;
            }
            $object = CalendarObject::query()->where('uid', $uid)->first();
            if ($object === null) {
                $notices[] = 'star skip (object missing): '.$uid;

                continue;
            }
            NoteStar::query()->firstOrCreate([
                'username' => (string) $row->username,
                'calendar_object_id' => (int) $object->id,
            ], [
                'note_uid' => $uid,
            ]);
            $count++;
        }

        return $count;
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

    /**
     * Files under the personal and group `.notes` trees only: walking the
     * whole Drive would make the update slow on large installs.
     *
     * @return list<string>
     */
    private function legacyNoteFiles(): array
    {
        $disk = $this->storage->files();
        $files = [];
        foreach (['users', 'groups'] as $root) {
            foreach ($disk->directories($root) as $home) {
                if ($disk->directoryExists($home.'/.notes')) {
                    array_push($files, ...$disk->allFiles($home.'/.notes'));
                }
            }
        }

        return $files;
    }

    /**
     * @param  list<string>  $uids
     */
    private function reindexImported(array $uids): void
    {
        foreach ($uids as $uid) {
            $object = CalendarObject::query()->where('uid', $uid)->first();
            if ($object === null) {
                continue;
            }
            $instance = $object->calendar?->instances()->first();
            if ($instance === null) {
                continue;
            }
            $principal = (string) $instance->principaluri;
            $home = str_starts_with($principal, 'principals/') ? substr($principal, strlen('principals/')) : $principal;
            $path = 'calendars/'.$home.'/'.$instance->uri.'/'.$object->uri;
            $this->search->indexCalendarObjectFromPath($path);
        }
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
