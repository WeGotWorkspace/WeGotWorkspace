<?php

declare(strict_types=1);

namespace App\Services\Docs;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\DocsThreadIndex;
use App\Services\Calendars\CollectionKind;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\JmapAccountStateCodec;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;

/**
 * Push state of the `DocThread` type (#2286, docs/architecture/jmap-push.md).
 *
 * Docs comment threads live in one hidden VJOURNAL pool per file owner (a user or a Team).
 * An open document pulls `files/threads/changes` when this state moves, instead of polling.
 *
 * A root that is a whole owner tree (`users/<name>`, `groups/<slug>`) can read every thread
 * in that owner's pool, so its part of the state is the pool's sync token. A share root deeper
 * in someone else's tree reads only the threads on documents under it, so its part covers just
 * those threads (uid and etag): another document of the same owner never moves the state of a
 * user who cannot read it.
 */
final class DocThreadPushState
{
    /**
     * @param  list<string>  $roots  storage keys, as {@see FileNodeAccountSupport::rootsAndGrantPairs()} returns them
     */
    public function stateFor(array $roots): string
    {
        $wholeOwners = [];
        $scoped = [];
        foreach ($roots as $root) {
            $root = trim($root, '/');
            $owner = self::ownerOf($root);
            if ($owner === null) {
                continue;
            }
            if (substr_count($root, '/') === 1) {
                $wholeOwners[$owner] = true;
            } else {
                $scoped[$root] = $owner;
            }
        }

        $owners = array_keys($wholeOwners + array_fill_keys(array_values($scoped), true));
        if ($owners === []) {
            return JmapAccountStateCodec::compose([]);
        }
        $pools = $this->poolsOf($owners);

        $tokens = [];
        foreach (array_keys($wholeOwners) as $owner) {
            if (isset($pools[$owner])) {
                $tokens[$owner] = (string) $pools[$owner]['synctoken'];
            }
        }
        foreach ($scoped as $root => $owner) {
            if (isset($wholeOwners[$owner]) || ! isset($pools[$owner])) {
                continue;
            }
            // Keyed by a digest: a path may hold the codec's `,` and `:`.
            $tokens['share-'.substr(hash('sha256', $root), 0, 16)] = $this->scopedToken($pools[$owner]['calendarid'], '/'.$root);
        }

        return JmapAccountStateCodec::compose($tokens);
    }

    private static function ownerOf(string $root): ?string
    {
        try {
            return DocsThreadCollectionUris::ownerPrincipalUri('/'.$root);
        } catch (ApiHttpException) {
            return null; // Not under users/ or groups/: holds no threads.
        }
    }

    /**
     * Thread pools of the owners, in one indexed read.
     *
     * @param  list<string>  $owners  principal uris
     * @return array<string, array{calendarid: int, synctoken: int}>
     */
    private function poolsOf(array $owners): array
    {
        $pools = [];
        $instances = CalendarInstance::query()
            ->whereIn('principaluri', $owners)
            ->where('uri', DocsThreadCollectionUris::POOL_URI)
            ->whereHas('calendar', fn ($query) => $query->ofKind(CollectionKind::DocsThreadPool))
            ->with('calendar')
            ->get();
        foreach ($instances as $instance) {
            $pools[(string) $instance->principaluri] = [
                'calendarid' => (int) $instance->calendarid,
                'synctoken' => (int) ($instance->calendar->synctoken ?? 1),
            ];
        }

        return $pools;
    }

    /**
     * A digest of the threads (and replies) on documents at or under `$path` in one pool:
     * every create, edit, reaction, resolve or delete there changes an etag or the uid set.
     */
    private function scopedToken(int $calendarId, string $path): string
    {
        $prefix = $path.'/';
        $rows = DocsThreadIndex::query()
            ->join('calendarobjects', function (JoinClause $join): void {
                $join->on('calendarobjects.uid', '=', 'docs_thread_index.uid')
                    ->on('calendarobjects.calendarid', '=', 'docs_thread_index.calendarid');
            })
            ->where('docs_thread_index.calendarid', $calendarId)
            ->where(function (Builder $query) use ($path, $prefix): void {
                $query->where('docs_thread_index.doc_path', $path)
                    ->orWhere('docs_thread_index.doc_path', 'like', $prefix.'%');
            })
            ->toBase()
            ->get(['docs_thread_index.uid', 'docs_thread_index.doc_path', 'calendarobjects.etag']);

        $lines = [];
        foreach ($rows as $row) {
            $docPath = (string) $row->doc_path;
            // LIKE ignores case and reads `_` and `%` as wildcards; only exact paths count.
            if ($docPath !== $path && ! str_starts_with($docPath, $prefix)) {
                continue;
            }
            $lines[] = $row->uid.'='.$row->etag;
        }
        sort($lines, SORT_STRING);

        return substr(hash('sha256', implode("\n", $lines)), 0, 16);
    }
}
