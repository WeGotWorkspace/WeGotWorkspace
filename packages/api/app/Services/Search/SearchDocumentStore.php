<?php

declare(strict_types=1);

namespace App\Services\Search;

use App\Models\CalendarObject;
use App\Models\CalendarShareDismissal;
use App\Models\Card;
use App\Models\SearchDocument;
use App\Models\SearchTerm;
use Illuminate\Database\Eloquent\Builder;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

final class SearchDocumentStore
{
    public function __construct(
        private SearchTokenService $tokens,
    ) {}

    /**
     * @param  array<string, mixed>  $document
     * @param  array<string, list<string>>  $tokensByField
     */
    public function upsert(string $sourceType, string $sourceKey, array $document, array $tokensByField): void
    {
        // UTC so updated_at stays in lexicographic order across a DST change.
        // deleteStaleRows() compares this string against a gmdate('c') cutoff.
        $now = gmdate('c');
        $payload = [
            'source_type' => $sourceType,
            'source_subtype' => $this->nullableString($document['source_subtype'] ?? null),
            'source_key' => $sourceKey,
            'owner_username' => $this->nullableString($document['owner_username'] ?? null),
            'collection_id' => $this->nullableInt($document['collection_id'] ?? null),
            'object_id' => $this->nullableInt($document['object_id'] ?? null),
            'group_slug' => $this->nullableString($document['group_slug'] ?? null),
            'title' => $this->nullableString($document['title'] ?? null),
            'extension' => $this->nullableString($document['extension'] ?? null),
            'category' => $this->nullableString($document['category'] ?? null),
            'content_type' => $this->nullableString($document['content_type'] ?? null),
            'size' => $this->nullableInt($document['size'] ?? null),
            'created_at_ts' => $this->nullableInt($document['created_at_ts'] ?? null),
            'modified_at_ts' => $this->nullableInt($document['modified_at_ts'] ?? null),
            'body_text' => $this->nullableString($document['body_text'] ?? null),
            'metadata_json' => $this->encodeJson($document['metadata'] ?? null),
            'updated_at' => $now,
        ];

        SearchDocument::query()->updateOrInsert(
            ['source_type' => $sourceType, 'source_key' => $sourceKey],
            array_merge($payload, ['created_at' => $now])
        );

        $documentId = SearchDocument::query()
            ->where('source_type', $sourceType)
            ->where('source_key', $sourceKey)
            ->value('id');
        if (! is_int($documentId) && ! ctype_digit((string) $documentId)) {
            return;
        }
        $this->replaceTokens((int) $documentId, $tokensByField);
    }

    public function delete(string $sourceType, string $sourceKey): void
    {
        SearchDocument::query()
            ->where('source_type', $sourceType)
            ->where('source_key', $sourceKey)
            ->delete();
    }

    public function deletePrefix(string $sourceType, string $sourceKeyPrefix): void
    {
        SearchDocument::query()
            ->where('source_type', $sourceType)
            ->where('source_key', 'like', $sourceKeyPrefix.'/%')
            ->delete();
    }

    /**
     * Drop file and note rows whose storage key is no longer a live file node.
     * Terms go with the document via the foreign key. The key is the storage
     * key, so this can be exact. Calendar and contact rows cannot: their
     * source keys are decoded in PHP, and deleteStaleRows() drops whatever
     * the phase did not refresh.
     */
    public function deleteFileLikeOrphans(): void
    {
        SearchDocument::query()
            ->whereIn('source_type', ['file', 'note'])
            ->whereNotExists(function ($query): void {
                $query->selectRaw('1')
                    ->from('jmap_file_nodes')
                    ->whereColumn('jmap_file_nodes.storage_key', 'search_documents.source_key')
                    ->whereNull('jmap_file_nodes.deleted_at');
            })
            ->delete();
    }

    /**
     * Drop rows of one source that this phase did not refresh. `$cutoff` is
     * gmdate('c'), captured before the phase. upsert() writes that same clock.
     */
    public function deleteStaleRows(string $sourceType, string $cutoff): void
    {
        SearchDocument::query()
            ->where('source_type', $sourceType)
            ->where('updated_at', '<', $cutoff)
            ->delete();
    }

    /**
     * @param  array<string, mixed>  $filters
     * @param  list<string>  $groupSlugs
     * @param  list<string>  $sources
     * @param  list<string>  $tokens
     * @return list<array<string, mixed>>
     */
    public function search(
        string $username,
        array $groupSlugs,
        array $tokens,
        int $limit,
        array $sources,
        array $filters = [],
        int $offset = 0,
    ): array {
        $query = SearchDocument::query()
            ->from('search_documents as d')
            ->select('d.*');

        if ($tokens !== []) {
            $scoreParts = [];
            $bindings = [];
            foreach ($tokens as $token) {
                $scoreParts[] = '(SELECT COALESCE(SUM(st.weight), 0) FROM search_terms st WHERE st.document_id = d.id AND st.token LIKE ?)';
                $bindings[] = $token.'%';
            }
            $query->selectRaw(implode(' + ', $scoreParts).' AS token_score', $bindings);
        } else {
            $query->selectRaw('0 AS token_score');
        }

        $this->whereReadable($query, $username, $groupSlugs);

        if ($sources !== []) {
            $query->whereIn('d.source_type', $sources);
        }
        if (isset($filters['categories']) && is_array($filters['categories']) && $filters['categories'] !== []) {
            $query->whereIn('d.category', $filters['categories']);
        }
        if (isset($filters['extensions']) && is_array($filters['extensions']) && $filters['extensions'] !== []) {
            $query->whereIn('d.extension', $filters['extensions']);
        }
        if (isset($filters['modified_from']) && is_int($filters['modified_from'])) {
            $query->where('d.modified_at_ts', '>=', $filters['modified_from']);
        }
        if (isset($filters['modified_to']) && is_int($filters['modified_to'])) {
            $query->where('d.modified_at_ts', '<=', $filters['modified_to']);
        }
        if (isset($filters['path_prefix']) && is_string($filters['path_prefix']) && $filters['path_prefix'] !== '') {
            $prefix = $filters['path_prefix'];
            // File/note source keys are storage paths, so scope them by prefix. Calendar/
            // contact keys are not path-shaped, so they are left unaffected by this filter.
            $query->where(function ($scope) use ($prefix): void {
                $scope->where(function ($paths) use ($prefix): void {
                    $paths->whereIn('d.source_type', ['file', 'note'])
                        ->where('d.source_key', 'like', $prefix.'/%');
                })->orWhereNotIn('d.source_type', ['file', 'note']);
            });
        }

        if ($tokens !== []) {
            $query->where(function ($match) use ($tokens): void {
                foreach ($tokens as $token) {
                    $match->orWhere('d.title', 'like', '%'.$token.'%')
                        ->orWhere('d.body_text', 'like', '%'.$token.'%')
                        ->orWhereExists(function ($sub) use ($token): void {
                            $sub->selectRaw('1')
                                ->from('search_terms as st')
                                ->whereColumn('st.document_id', 'd.id')
                                ->where('st.token', 'like', $token.'%');
                        });
                }
            });
        }

        /** @var list<array<string, mixed>> $rows */
        $rows = $query
            ->orderByDesc('token_score')
            ->orderByDesc('d.modified_at_ts')
            ->orderByDesc('d.id')
            ->offset(max(0, $offset))
            ->limit(max(1, min(100, $limit)))
            ->get()
            ->map(static fn (SearchDocument $row): array => $row->toArray())
            ->all();

        return $rows;
    }

    /**
     * @param  list<string>  $groupSlugs
     * @return array<string, mixed>|null
     */
    public function findAccessibleDocument(
        string $username,
        array $groupSlugs,
        string $sourceType,
        string $sourceKey,
    ): ?array {
        $query = SearchDocument::query()
            ->from('search_documents as d')
            ->where('d.source_type', $sourceType)
            ->where('d.source_key', $sourceKey);
        $this->whereReadable($query, $username, $groupSlugs);
        $row = $query->first();

        return $row ? (array) $row->toArray() : null;
    }

    /**
     * Rows the caller may read right now. Files and notes follow the storage
     * path (own home, current groups). CalDAV and CardDAV rows also need their
     * collection to still be the caller's: a live instance of one of the
     * caller's principals, not dismissed by the caller, holding the object.
     * A revoked share, a dismissed share, a left group or a deleted item drops
     * out at once, without waiting for a reindex.
     *
     * @param  Builder<SearchDocument>  $query
     * @param  list<string>  $groupSlugs
     */
    private function whereReadable(Builder $query, string $username, array $groupSlugs): void
    {
        $groupSlugs = array_values(array_filter($groupSlugs, static fn (string $slug): bool => trim($slug) !== ''));
        $davOwners = array_values(array_unique(array_merge(
            [$username],
            array_map(static fn (string $slug): string => 'groups/'.$slug, $groupSlugs),
        )));
        $principalUris = array_map(static fn (string $owner): string => 'principals/'.$owner, $davOwners);

        $query->where(function ($auth) use ($username, $groupSlugs, $davOwners, $principalUris): void {
            $auth->where(function ($q) use ($username): void {
                $q->whereIn('d.source_type', ['file', 'note'])
                    ->where('d.owner_username', $username);
            });

            if ($groupSlugs !== []) {
                $auth->orWhere(function ($q) use ($groupSlugs): void {
                    $q->where('d.source_type', 'file')
                        ->whereIn('d.group_slug', $groupSlugs);
                });
            }

            $auth->orWhere(function ($q) use ($username, $davOwners, $principalUris): void {
                $q->where('d.source_type', 'caldav')
                    ->whereIn('d.owner_username', $davOwners)
                    ->whereExists($this->liveCalendarObject($username, $principalUris));
            });

            $auth->orWhere(function ($q) use ($davOwners, $principalUris): void {
                $q->where('d.source_type', 'carddav')
                    ->whereIn('d.owner_username', $davOwners)
                    ->whereExists($this->liveCard($principalUris));
            });
        });
    }

    /**
     * @param  list<string>  $principalUris
     * @return Builder<CalendarObject>
     */
    private function liveCalendarObject(string $username, array $principalUris): Builder
    {
        return CalendarObject::query()
            ->from('calendarobjects as o')
            ->join('calendarinstances as i', 'i.calendarid', '=', 'o.calendarid')
            ->selectRaw('1')
            ->whereColumn('o.id', 'd.object_id')
            ->whereColumn('i.id', 'd.collection_id')
            ->whereIn('i.principaluri', $principalUris)
            ->where(function ($visible) use ($username): void {
                // Same rule as CalendarShareVisibility: a dismissal hides sharee copies only.
                $visible->whereNull('i.access')
                    ->orWhereNotIn('i.access', [SharingPlugin::ACCESS_READ, SharingPlugin::ACCESS_READWRITE])
                    ->orWhereNotIn(
                        'i.calendarid',
                        CalendarShareDismissal::query()->select('calendarid')->where('username', $username),
                    );
            });
    }

    /**
     * @param  list<string>  $principalUris
     * @return Builder<Card>
     */
    private function liveCard(array $principalUris): Builder
    {
        return Card::query()
            ->from('cards as c')
            ->join('addressbooks as a', 'a.id', '=', 'c.addressbookid')
            ->selectRaw('1')
            ->whereColumn('c.id', 'd.object_id')
            ->whereColumn('a.id', 'd.collection_id')
            ->whereIn('a.principaluri', $principalUris);
    }

    /**
     * @param  array<string, list<string>>  $tokensByField
     */
    private function replaceTokens(int $documentId, array $tokensByField): void
    {
        SearchTerm::query()
            ->where('document_id', $documentId)
            ->delete();

        $rows = [];
        $seen = [];
        $now = date('c');
        foreach ($tokensByField as $field => $tokens) {
            $weight = $field === 'title' ? 8 : ($field === 'meta' ? 4 : 2);
            foreach ($tokens as $token) {
                $normalizedToken = $this->tokens->normalizeToken($token);
                if ($normalizedToken === '' || mb_strlen($normalizedToken) < 2) {
                    continue;
                }
                $dedupeKey = $field."\0".$normalizedToken;
                if (isset($seen[$dedupeKey])) {
                    continue;
                }
                $seen[$dedupeKey] = true;
                $rows[] = [
                    'document_id' => $documentId,
                    'token' => $normalizedToken,
                    'field' => $field,
                    'weight' => $weight,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }
        if ($rows !== []) {
            SearchTerm::query()->insert($rows);
        }
    }

    private function nullableString(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function nullableInt(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value;
        }
        if (is_numeric($value)) {
            return (int) $value;
        }

        return null;
    }

    private function encodeJson(mixed $value): ?string
    {
        if (! is_array($value)) {
            return null;
        }

        $encoded = json_encode($value, JSON_UNESCAPED_SLASHES);

        return $encoded === false ? null : $encoded;
    }
}
