<?php

declare(strict_types=1);

namespace Tests\Feature\Search;

use Tests\TestCase;

/**
 * Search rows carry collection_id and object_id from
 * 2026_10_29_000765_wgw_search_documents_collection_ids onwards. A migration
 * that indexes items before that one runs would write to columns that do not
 * exist yet, and those items would stay out of search until a full reindex.
 */
final class SearchColumnsMigrationOrderTest extends TestCase
{
    private const COLUMNS_MIGRATION = '2026_10_29_000765_wgw_search_documents_collection_ids';

    /** Code a migration can use to write search rows. */
    private const INDEXING_PATTERN = '/\b(NotesFileMigrator|NoteRepository|TaskRepository|SearchIndexerService|SearchDocumentStore|BestEffortSearchIndexSync)\b/';

    public function test_migrations_that_index_items_run_after_the_search_columns_exist(): void
    {
        $names = array_keys(app('migrator')->getMigrationFiles([database_path('migrations/wgw')]));
        $columnsAt = array_search(self::COLUMNS_MIGRATION, $names, true);
        $this->assertIsInt($columnsAt);

        $indexing = [];
        foreach ($names as $at => $name) {
            $source = (string) file_get_contents(database_path('migrations/wgw/'.$name.'.php'));
            if (preg_match(self::INDEXING_PATTERN, $source) === 1) {
                $indexing[$name] = $at;
            }
        }

        $this->assertArrayHasKey('2026_10_29_000770_wgw_import_legacy_markdown_notes', $indexing);
        foreach ($indexing as $name => $at) {
            $this->assertGreaterThan($columnsAt, $at, $name.' indexes items before the search columns exist.');
        }
    }
}
