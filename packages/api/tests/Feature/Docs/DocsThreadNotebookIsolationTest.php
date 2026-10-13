<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Models\Principal;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * Docs thread pools and notebooks are both VJOURNAL-only. The stored
 * CollectionKind is the discriminator. Notebooks cannot take the pool uri.
 */
final class DocsThreadNotebookIsolationTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->dataDir = storage_path('framework/testing/wgw-docs-kind-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files/users/alice/docs');
        File::ensureDirectoryExists($this->dataDir.'/files/users/bob/docs');
        File::ensureDirectoryExists($this->dataDir.'/files/groups/team/docs');
        WgwTestDisks::refresh($this->dataDir);
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }
        parent::tearDown();
    }

    public function test_docs_thread_pool_is_absent_from_the_notebook_list(): void
    {
        $this->createUserThread('alice', '/users/alice/docs/plan.md', '01J6Y6M0R2V9GKJ4W1T8Q3ZBEX');

        $notebooks = $this->asUser('alice')->getJson('/api/v1/notes/notebooks')->assertOk()->json('list');
        $this->assertIsArray($notebooks);
        foreach ($notebooks as $notebook) {
            $this->assertNotSame('docs-threads', $notebook['id']);
            $this->assertNotSame('Docs threads', $notebook['name']);
        }
    }

    public function test_docs_thread_pool_cannot_be_read_as_a_notebook(): void
    {
        $this->createUserThread('alice', '/users/alice/docs/plan.md', '01J6Y6M0R2V9GKJ4W1T8Q3ZBEY');

        $this->asUser('alice')->getJson('/api/v1/notes/notebooks/docs-threads')->assertNotFound();
    }

    public function test_docs_thread_pool_cannot_be_patched_as_a_notebook(): void
    {
        $this->createUserThread('alice', '/users/alice/docs/plan.md', '01J6Y6M0R2V9GKJ4W1T8Q3ZBEZ');

        $this->asUser('alice')->patchJson('/api/v1/notes/notebooks/docs-threads', [
            'name' => 'Hijacked',
        ])->assertNotFound();
        $this->asUser('alice')->patchJson('/api/v1/notes/notebooks/docs-threads', [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertNotFound();
    }

    public function test_docs_thread_pool_cannot_be_deleted_as_a_notebook(): void
    {
        $rootId = '01J6Y6M0R2V9GKJ4W1T8Q3ZBF0';
        $path = '/users/alice/docs/plan.md';
        $this->createUserThread('alice', $path, $rootId);

        // The boolean rule accepts 1/0, not the string "true" (NotesVjournalRestTest).
        $this->asUser('alice')
            ->deleteJson('/api/v1/notes/notebooks/docs-threads?onDestroyRemoveContents=1')
            ->assertNotFound();

        $this->asUser('alice')
            ->getJson('/api/v1/files/threads?path='.urlencode($path))
            ->assertOk()
            ->assertJsonPath('list.0.id', $rootId);
    }

    public function test_notes_cannot_be_written_into_the_docs_thread_pool(): void
    {
        $this->createUserThread('alice', '/users/alice/docs/plan.md', '01J6Y6M0R2V9GKJ4W1T8Q3ZBF1');

        $this->asUser('alice')->postJson('/api/v1/notes/items', [
            'notebookId' => 'docs-threads',
            'title' => 'Sneaky note',
            'body' => 'x',
        ])->assertNotFound();
    }

    public function test_docs_thread_pool_is_absent_from_jmap_notebook_get(): void
    {
        $this->createUserThread('alice', '/users/alice/docs/plan.md', '01J6Y6M0R2V9GKJ4W1T8Q3ZBF2');

        $response = $this->asUser('alice')->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::NOTES],
            'methodCalls' => [
                ['Notebook/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
            ],
        ])->assertOk();

        $ids = array_column($response->json('methodResponses.0.1.list'), 'id');
        $this->assertNotContains('docs-threads', $ids);
    }

    public function test_group_docs_thread_pool_is_absent_from_the_notebook_list(): void
    {
        $group = $this->seedWgwGroup('principals/groups/team', 'Team');
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $this->addPrincipalToGroup($group, $alice);

        app(WgwStorage::class)->files()->put('groups/team/docs/plan.md', "# Plan\n");
        $this->asUser('alice')->postJson('/api/v1/files/threads?path='.urlencode('/groups/team/docs/plan.md'), [
            'id' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBF3',
            'kind' => 'comment',
            'body' => 'a thread',
            'anchorText' => 'Plan',
        ])->assertCreated();

        $notebooks = $this->asUser('alice')->getJson('/api/v1/notes/notebooks')->assertOk()->json('list');
        $this->assertIsArray($notebooks);
        foreach ($notebooks as $notebook) {
            $this->assertNotSame('docs-threads', $notebook['id']);
            $this->assertNotSame('Docs threads', $notebook['name']);
        }
    }

    public function test_a_notebook_cannot_claim_the_docs_thread_pool_uri(): void
    {
        $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'id' => 'docs-threads',
            'name' => 'Not the pool',
        ])->assertStatus(409)->assertJsonPath('error', 'This notebook id is reserved for docs threads.');

        $created = $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Docs threads',
        ])->assertCreated()->json();
        $this->assertSame('notebook-docs-threads', $created['id']);

        app(WgwStorage::class)->files()->put('users/alice/docs/plan.md', "# Plan\n");
        $threadId = '01J6Y6M0R2V9GKJ4W1T8Q3ZBF4';
        $this->asUser('alice')->postJson('/api/v1/files/threads?path='.urlencode('/users/alice/docs/plan.md'), [
            'id' => $threadId,
            'kind' => 'comment',
            'body' => 'a thread',
            'anchorText' => 'Plan',
        ])->assertCreated();

        $this->asUser('alice')
            ->getJson('/api/v1/files/threads?path='.urlencode('/users/alice/docs/plan.md'))
            ->assertOk()
            ->assertJsonPath('list.0.id', $threadId);
        $this->asUser('alice')
            ->getJson('/api/v1/notes/notebooks/notebook-docs-threads')
            ->assertOk()
            ->assertJsonPath('name', 'Docs threads');
        $this->asUser('alice')
            ->getJson('/api/v1/notes/items?notebookId=notebook-docs-threads')
            ->assertOk()
            ->assertJsonPath('list', []);
    }

    private function createUserThread(string $username, string $path, string $id): void
    {
        $relative = ltrim($path, '/');
        app(WgwStorage::class)->files()->put($relative, "# Plan\n");
        $this->asUser($username)->postJson('/api/v1/files/threads?path='.urlencode($path), [
            'id' => $id,
            'kind' => 'comment',
            'body' => 'a thread',
            'anchorText' => 'Plan',
        ])->assertCreated();
    }

    private function asUser(string $username)
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
