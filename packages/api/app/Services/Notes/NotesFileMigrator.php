<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\CalendarObject;
use App\Models\DriveStarredItem;
use App\Models\NoteStar;
use App\Services\Notes\Conversion\NoteJournalConverter;
use App\Services\Search\SearchIndexerService;
use App\Storage\WgwStorage;
use Illuminate\Support\Str;

/**
 * One-way import of Drive `.notes/*.md` files into VJOURNAL notebooks.
 */
final class NotesFileMigrator
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly NoteMarkdownCodec $codec,
        private readonly NotebookRepository $notebooks,
        private readonly NoteRepository $notes,
        private readonly SearchIndexerService $search,
    ) {}

    /**
     * @return array{
     *   mapped: int,
     *   imported: int,
     *   starred: int,
     *   skipped: int,
     *   discardedYjs: int,
     *   images: int,
     *   notices: list<string>
     * }
     */
    public function migrate(): array
    {
        $disk = $this->storage->files();
        $pathToUid = $this->buildPathUidMap($disk->allFiles());
        $imported = 0;
        $skipped = 0;
        $starred = 0;
        $images = 0;
        $discardedYjs = 0;
        $notices = [];

        foreach ($pathToUid as $virtualPath => $uid) {
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

            try {
                $this->notes->create($username, [
                    'notebookId' => $notebook['id'],
                    'uid' => $uid,
                    'title' => $title !== '' ? $title : null,
                    'body' => $body,
                    'categories' => $tags,
                    'status' => $parsed['archived'] ? 'CANCELLED' : null,
                ]);
                $imported++;
            } catch (\Throwable $exception) {
                $skipped++;
                $notices[] = 'import failed '.$virtualPath.': '.$exception->getMessage();
            }
        }

        $starred = $this->backfillStars($pathToUid, $notices);
        $discardedYjs = $this->discardYjsSidecars($disk->allFiles());
        $this->reindexImported(array_values($pathToUid));

        return [
            'mapped' => count($pathToUid),
            'imported' => $imported,
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
            $map['/'.$key] = (string) Str::uuid();
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

        return count($matches[0] ?? []);
    }

    /**
     * @param  array<string, string>  $pathToUid
     * @param  list<string>  $notices
     */
    private function backfillStars(array $pathToUid, array &$notices): int
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
        foreach ($files as $key) {
            $key = ltrim(str_replace('\\', '/', (string) $key), '/');
            if (! preg_match('#(?:^|/)\\.[^/]+\\.md\\.yjs$#', $key) && ! str_ends_with($key, '.md.yjs')) {
                continue;
            }
            if (! str_contains($key, '/.notes/')) {
                continue;
            }
            if ($disk->fileExists($key)) {
                $disk->delete($key);
                $discarded++;
            }
        }

        return $discarded;
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
        $group = \App\Models\Principal::query()
            ->where('uri', 'principals/groups/'.$groupSlug)
            ->first();
        if ($group === null) {
            return null;
        }
        $member = \App\Models\GroupMember::query()
            ->where('principal_id', (int) $group->id)
            ->orderBy('id')
            ->first();
        $uri = (string) ($member?->member?->uri ?? '');
        if (str_starts_with($uri, 'principals/') && ! str_starts_with($uri, 'principals/groups/')) {
            return substr($uri, strlen('principals/'));
        }

        return null;
    }
}
