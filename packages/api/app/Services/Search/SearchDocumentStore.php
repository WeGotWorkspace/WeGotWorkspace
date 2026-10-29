<?php

declare(strict_types=1);

namespace App\Services\Search;

use App\Models\SearchDocument;
use App\Models\SearchTerm;
use Illuminate\Support\Facades\Log;

final class SearchDocumentStore
{
    /**
     * Column lengths in search_documents. MySQL strict mode rejects a longer
     * value (1406), which used to stop a whole reindex.
     */
    private const MAX_SOURCE_KEY_LENGTH = 512;

    private const MAX_TITLE_LENGTH = 512;

    private const MAX_EXTENSION_LENGTH = 32;

    public function __construct(
        private SearchTokenService $tokens,
    ) {}

    /**
     * @param  array<string, mixed>  $document
     * @param  array<string, list<string>>  $tokensByField
     */
    public function upsert(string $sourceType, string $sourceKey, array $document, array $tokensByField): void
    {
        // The key identifies the document, so it cannot be cut short. A file
        // nested deeper than the column allows stays out of search.
        if (mb_strlen($sourceKey) > self::MAX_SOURCE_KEY_LENGTH) {
            Log::warning('search_index_source_key_too_long', [
                'source_type' => $sourceType,
                'length' => mb_strlen($sourceKey),
            ]);

            return;
        }

        // UTC so updated_at stays in lexicographic order across a DST change.
        // deleteStaleRows() compares this string against a gmdate('c') cutoff.
        $now = gmdate('c');
        $payload = [
            'source_type' => $sourceType,
            'source_subtype' => $this->nullableString($document['source_subtype'] ?? null),
            'source_key' => $sourceKey,
            'owner_username' => $this->nullableString($document['owner_username'] ?? null),
            'group_slug' => $this->nullableString($document['group_slug'] ?? null),
            'title' => $this->nullableString($document['title'] ?? null, self::MAX_TITLE_LENGTH),
            'extension' => $this->nullableString($document['extension'] ?? null, self::MAX_EXTENSION_LENGTH),
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
        $groupPrincipalOwners = array_values(array_unique(array_map(
            static fn (string $slug): string => 'groups/'.$slug,
            array_values(array_filter($groupSlugs, static fn (string $slug): bool => trim($slug) !== ''))
        )));
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

        $query->where(function ($auth) use ($username, $groupSlugs, $groupPrincipalOwners): void {
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

            $auth->orWhere(function ($q) use ($username): void {
                $q->whereIn('d.source_type', ['caldav', 'carddav'])
                    ->where('d.owner_username', $username);
            });

            if ($groupPrincipalOwners !== []) {
                $auth->orWhere(function ($q) use ($groupPrincipalOwners): void {
                    $q->whereIn('d.source_type', ['caldav', 'carddav'])
                        ->whereIn('d.owner_username', $groupPrincipalOwners);
                });
            }
        });

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
        $groupPrincipalOwners = array_values(array_unique(array_map(
            static fn (string $slug): string => 'groups/'.$slug,
            array_values(array_filter($groupSlugs, static fn (mixed $slug): bool => trim($slug) !== ''))
        )));

        $row = SearchDocument::query()
            ->from('search_documents as d')
            ->where('d.source_type', $sourceType)
            ->where('d.source_key', $sourceKey)
            ->where(function ($auth) use ($username, $groupSlugs, $groupPrincipalOwners): void {
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

                $auth->orWhere(function ($q) use ($username): void {
                    $q->whereIn('d.source_type', ['caldav', 'carddav'])
                        ->where('d.owner_username', $username);
                });

                if ($groupPrincipalOwners !== []) {
                    $auth->orWhere(function ($q) use ($groupPrincipalOwners): void {
                        $q->whereIn('d.source_type', ['caldav', 'carddav'])
                            ->whereIn('d.owner_username', $groupPrincipalOwners);
                    });
                }
            })
            ->first();

        return $row ? (array) $row->toArray() : null;
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

    private function nullableString(mixed $value, ?int $maxLength = null): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }

        return $maxLength === null ? $trimmed : mb_substr($trimmed, 0, $maxLength);
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
