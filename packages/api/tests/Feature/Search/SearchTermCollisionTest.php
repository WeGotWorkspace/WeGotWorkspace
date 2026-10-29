<?php

declare(strict_types=1);

namespace Tests\Feature\Search;

use App\Models\SearchDocument;
use App\Models\SearchTerm;
use App\Services\Search\SearchIndexerService;
use App\Services\Search\UnifiedSearchService;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * Issue #1063: MySQL's utf8mb4_unicode_ci treats "één" and "een" (and
 * "straße" and "strasse") as one value, so the unique (document, token,
 * field) index rejected a document that used both spellings. SQLite compares
 * tokens byte for byte and keeps both rows. Either way, saving must succeed
 * and both spellings must find the document.
 */
final class SearchTermCollisionTest extends WgwDatabaseTestCase
{
    private const KEY = 'users/alice/spellings.txt';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->dataDir = storage_path('framework/testing/wgw-search-collision-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files/users/alice');
        WgwTestDisks::refresh($this->dataDir);
        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    public function test_saving_a_file_with_accented_and_plain_spellings_indexes_both(): void
    {
        app(WgwStorage::class)->files()->put(self::KEY, "Één keer een plan.\nStraße of strasse.");

        app(SearchIndexerService::class)->indexFileStorageKey(self::KEY);
        // A second save replaces the terms; it must not trip over the first set.
        app(SearchIndexerService::class)->indexFileStorageKey(self::KEY);

        $documentId = SearchDocument::query()
            ->where('source_type', 'file')
            ->where('source_key', self::KEY)
            ->value('id');
        $this->assertNotNull($documentId);

        foreach (['één', 'een', 'straße', 'strasse'] as $spelling) {
            // Exactly one row compares equal under the column's own collation:
            // the shared row on MySQL, the spelling's own row on SQLite.
            $this->assertSame(1, SearchTerm::query()
                ->where('document_id', $documentId)
                ->where('field', 'body')
                ->where('token', $spelling)
                ->count(), 'body token '.$spelling);
        }

        foreach (['één', 'een'] as $spelling) {
            // The prefix match the search scorer runs finds either accent
            // spelling. (MySQL LIKE compares per character, so "ß" never
            // prefix-matches "ss"; that pair is only found through body text.)
            $this->assertTrue(SearchTerm::query()
                ->where('document_id', $documentId)
                ->where('field', 'body')
                ->where('token', 'like', $spelling.'%')
                ->exists(), 'body prefix '.$spelling);
        }

        $search = app(UnifiedSearchService::class);
        foreach (['één', 'een'] as $query) {
            $keys = array_column($search->search('alice', $query, 20, ['file'])['results'], 'sourceKey');
            $this->assertContains(self::KEY, $keys, 'search '.$query);
        }
    }
}
