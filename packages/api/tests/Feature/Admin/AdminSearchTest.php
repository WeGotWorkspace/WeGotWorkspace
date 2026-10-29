<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Models\JmapFileNode;
use App\Models\SearchDocument;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Search\SearchReindexRunner;
use App\Services\Search\SearchReindexStateStore;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\Cache;
use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class AdminSearchTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
        app(WgwStorage::class)->files()->put('users/alice/admin-search.txt', 'Search reindex coverage');
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_admin_can_run_and_read_search_reindex_state(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->postJson('/api/v1/admin/search/jobs')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('message', 'Search reindex completed.');

        $this->withBearer($token)
            ->getJson('/api/v1/admin/search/jobs/current')
            ->assertOk()
            ->assertJsonPath('inProgress', false)
            ->assertJsonPath('lastResult.ok', true);
    }

    /**
     * Issue #1063: on MySQL the unique (document, token, field) index treats
     * "één" and "een" as one value, which used to abort the whole reindex.
     */
    public function test_reindex_completes_when_a_file_has_accented_and_plain_spellings(): void
    {
        app(WgwStorage::class)->files()->put('users/alice/spellings.txt', 'één een Straße strasse');

        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/search/jobs')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('message', 'Search reindex completed.');

        $this->assertTrue(SearchDocument::query()
            ->where('source_type', 'file')
            ->where('source_key', 'users/alice/spellings.txt')
            ->exists());
    }

    public function test_stale_reindex_state_clears_without_taking_the_lock(): void
    {
        $store = app(SearchReindexStateStore::class);
        $store->ensureDirs();
        $store->write([
            'phase' => 'indexing_file_nodes',
            'phase_updated_at' => date('c', time() - 700),
        ]);

        $lock = Cache::lock('search-reindex-runner', 900);
        $this->assertTrue($lock->get());
        try {
            $state = app(SearchReindexRunner::class)->getState();
            $this->assertFalse($state['inProgress']);
            $this->assertNull($state['phase']);
        } finally {
            $lock->release();
        }
    }

    public function test_backfill_progress_callback_can_stop_the_walk_before_files_are_minted(): void
    {
        $ticked = false;
        try {
            app(FileNodeIndexService::class)->reindexAll(progress: function (int $done, int $total) use (&$ticked): void {
                $this->assertGreaterThan(0, $done);
                $this->assertGreaterThanOrEqual($done, $total);
                $ticked = true;
                throw new \RuntimeException('Search reindex cancelled by user.');
            });
            $this->fail('Expected the progress callback to abort the backfill.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Search reindex cancelled by user.', $e->getMessage());
        }

        $this->assertTrue($ticked);
        $this->assertNull(
            JmapFileNode::query()
                ->where('storage_key', 'users/alice/admin-search.txt')
                ->whereNull('deleted_at')
                ->first(),
        );
    }

    public function test_cancel_search_reindex_when_idle_returns_bad_request(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->deleteJson('/api/v1/admin/search/jobs/current')
            ->assertBadRequest()
            ->assertJsonPath('error', 'No search reindex is currently running.');
    }

    public function test_non_admin_cannot_run_search_reindex(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/admin/search/jobs')
            ->assertForbidden();

        $this->withBearer($this->carolBearerToken())
            ->deleteJson('/api/v1/admin/search/jobs/current')
            ->assertForbidden();
    }

    /**
     * A 200-character hex string is longer than search_terms.token (120).
     * MySQL strict mode used to reject it and abort the whole reindex.
     */
    public function test_reindex_completes_when_a_file_has_a_token_longer_than_the_column(): void
    {
        app(WgwStorage::class)->files()->put(
            'users/alice/checksum.txt',
            'sha '.str_repeat('0123456789abcdef', 12).'01234567',
        );

        $this->withBearer($this->adminBearerToken())
            ->postJson('/api/v1/admin/search/jobs')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('message', 'Search reindex completed.');
    }
}
