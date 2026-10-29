<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Models\JmapFileNode;
use App\Services\Drive\DriveService;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\WgwStorage;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A Docs save names the FileNode it opened (`&node=fn-…`). When that file is
 * no longer at the path, the save is refused with 404 instead of writing a new
 * file at the old path, so the editor can follow the file (#1751).
 */
final class DocsCollabSaveByNodeIdTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use SendsFramedCollaboration;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_save_naming_the_file_at_the_path_writes(): void
    {
        $id = $this->indexedDoc('plan.md');

        $this->save('/users/bob/plan.md', $id, "# Plan\n\nSaved.\n")->assertOk();

        $this->assertSame("# Plan\n\nSaved.\n", $this->stored('users/bob/plan.md'));
    }

    public function test_save_after_the_file_moved_is_404_and_writes_nothing(): void
    {
        $id = $this->indexedDoc('plan.md');
        app(DriveService::class)->renameItem($this->drivePrincipal('bob'), '/users/bob', 'plan.md', 'roadmap.md');

        $this->save('/users/bob/plan.md', $id, "# Plan\n\nTyped during the move.\n", ['If-None-Match' => '*'])
            ->assertNotFound();

        $disk = app(WgwStorage::class)->files();
        $this->assertFalse($disk->fileExists('users/bob/plan.md'), 'The old path must stay empty.');
        $this->assertFalse($disk->fileExists('users/bob/.plan.md.yjs'), 'No sidecar at the old path.');
        $this->assertSame($id, app(FileNodeIndexService::class)->liveByKey('users/bob/roadmap.md')?->node_id);
    }

    public function test_save_when_another_file_took_the_path_is_404(): void
    {
        $id = $this->indexedDoc('plan.md');
        app(DriveService::class)->renameItem($this->drivePrincipal('bob'), '/users/bob', 'plan.md', 'roadmap.md');
        $other = $this->indexedDoc('plan.md');
        $this->assertNotSame($id, $other);

        $this->save('/users/bob/plan.md', $id, "# Wrong file\n")->assertNotFound();

        $this->assertNotSame("# Wrong file\n", $this->stored('users/bob/plan.md'));
    }

    public function test_save_to_a_file_the_index_does_not_know_yet_writes(): void
    {
        $this->seedPrivateFile('bob', 'outside.md', '# Outside');
        $this->assertNull(app(FileNodeIndexService::class)->liveByKey('users/bob/outside.md'));

        $this->save('/users/bob/outside.md', 'fn-'.str_repeat('a', 32), "# Outside\n\nEdited.\n")->assertOk();
    }

    public function test_save_without_a_node_still_creates_the_file(): void
    {
        $this->save('/users/bob/new.md', null, "# New\n")->assertOk();

        $this->assertSame("# New\n", $this->stored('users/bob/new.md'));
    }

    public function test_a_malformed_node_is_a_bad_request(): void
    {
        $this->indexedDoc('plan.md');

        $this->save('/users/bob/plan.md', 'not-a-node', "# Plan\n")->assertStatus(400);
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function save(string $path, ?string $nodeId, string $markdown, array $headers = []): TestResponse
    {
        $url = '/api/v1/files/collaboration?path='.rawurlencode(ltrim($path, '/'));
        if ($nodeId !== null) {
            $url .= '&node='.rawurlencode($nodeId);
        }

        return $this->withBearer($this->userBearerToken())
            ->putCollaboration($url, $markdown, "\x01\x02", $headers);
    }

    private function stored(string $key): string
    {
        return (string) app(WgwStorage::class)->files()->get($key);
    }

    private function indexedDoc(string $name): string
    {
        $this->createDriveFile($this->userBearerToken(), '/users/bob', $name);
        $index = app(FileNodeIndexService::class);
        $node = $index->liveByKey('users/bob/'.$name) ?? $index->recordCreate('users/bob/'.$name);
        $this->assertInstanceOf(JmapFileNode::class, $node);

        return (string) $node->node_id;
    }
}
