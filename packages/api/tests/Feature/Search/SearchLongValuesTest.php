<?php

declare(strict_types=1);

namespace Tests\Feature\Search;

use App\Models\SearchDocument;
use App\Models\SearchTerm;
use App\Services\Search\SearchDocumentStore;
use App\Services\Search\SearchIndexerService;
use App\Services\Search\SearchTokenService;
use App\Services\Search\UnifiedSearchService;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * MySQL strict mode rejects a value longer than its column (1406 "Data too
 * long"). search_terms.token is 120 characters, search_documents.title 512,
 * extension 32 and source_key 512. One over-long value used to fail the save
 * and stop a whole reindex. SQLite has no length limit, so there the tests
 * pin the same capped values.
 */
final class SearchLongValuesTest extends WgwDatabaseTestCase
{
    private const KEY = 'users/alice/checksums.txt';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->dataDir = storage_path('framework/testing/wgw-search-long-'.uniqid('', true));
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

    public function test_file_with_a_token_longer_than_the_column_is_indexed_and_found(): void
    {
        $hex = str_repeat('0123456789abcdef', 12).'01234567'; // 200 characters
        app(WgwStorage::class)->files()->put(self::KEY, "sha {$hex} done");

        app(SearchIndexerService::class)->indexFileStorageKey(self::KEY);

        $documentId = SearchDocument::query()
            ->where('source_type', 'file')
            ->where('source_key', self::KEY)
            ->value('id');
        $this->assertNotNull($documentId);
        $stored = SearchTerm::query()
            ->where('document_id', $documentId)
            ->where('field', 'body')
            ->where('token', 'like', '0123%')
            ->pluck('token')
            ->all();
        $this->assertSame([substr($hex, 0, SearchTokenService::MAX_TOKEN_LENGTH)], $stored);

        $search = app(UnifiedSearchService::class);
        foreach ([$hex, substr($hex, 0, 16)] as $query) {
            $keys = array_column($search->search('alice', $query, 20, ['file'])['results'], 'sourceKey');
            $this->assertContains(self::KEY, $keys, 'search '.strlen($query).' chars');
        }
    }

    public function test_over_long_title_and_extension_are_capped(): void
    {
        $store = app(SearchDocumentStore::class);
        $title = str_repeat('Agenda item ', 60); // 720 characters, like a pasted event summary

        $store->upsert('caldav', 'alice|home|long.ics', [
            'owner_username' => 'alice',
            'title' => $title,
            'extension' => str_repeat('x', 40),
        ], ['title' => ['agenda', 'item']]);

        $row = SearchDocument::query()
            ->where('source_type', 'caldav')
            ->where('source_key', 'alice|home|long.ics')
            ->first();
        $this->assertNotNull($row);
        $this->assertSame(512, mb_strlen((string) $row->title));
        $this->assertSame(mb_substr(trim($title), 0, 512), $row->title);
        $this->assertSame(32, mb_strlen((string) $row->extension));
    }

    public function test_source_key_longer_than_the_column_is_skipped_not_fatal(): void
    {
        $key = 'users/alice/'.str_repeat('deep-folder/', 45).'file.txt'; // over 512 characters

        app(SearchDocumentStore::class)->upsert('file', $key, [
            'owner_username' => 'alice',
            'title' => 'file.txt',
        ], ['title' => ['file', 'txt']]);

        $this->assertFalse(SearchDocument::query()->where('source_type', 'file')->where('source_key', $key)->exists());
    }
}
