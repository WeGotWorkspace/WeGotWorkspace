<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Services\Drive\DriveService;
use Tests\Support\DocsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class DocsSearchIndexTest extends WgwDatabaseTestCase
{
    use DocsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDocsFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDocsFixtures();
        parent::tearDown();
    }

    public function test_store_indexes_markdown_document(): void
    {
        $this->storeDoc('bob', '/users/bob/docs', 'index-me.md', "# Indexed\n");

        $this->assertSearchDocumentExists('users/bob/docs/index-me.md');
    }

    public function test_rename_updates_search_index_for_docs_path(): void
    {
        $this->storeDoc('bob', '/users/bob/docs', 'index-me.md', "# Indexed\n");
        $this->assertSearchDocumentExists('users/bob/docs/index-me.md');

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/docs',
            '/users/bob/docs/index-me.md',
            'index-renamed.md',
        );

        $this->assertSearchDocumentMissing('users/bob/docs/index-me.md');
        $this->assertSearchDocumentExists('users/bob/docs/index-renamed.md');
    }

    public function test_delete_removes_docs_file_from_search_index(): void
    {
        $this->storeDoc('bob', '/users/bob/docs', 'index-me.md', "# Indexed\n");
        $this->assertSearchDocumentExists('users/bob/docs/index-me.md');

        app(DriveService::class)->deleteItems(
            $this->drivePrincipal('bob'),
            [['path' => '/users/bob/docs/index-me.md']],
        );

        $this->assertSearchDocumentMissing('users/bob/docs/index-me.md');
    }
}
