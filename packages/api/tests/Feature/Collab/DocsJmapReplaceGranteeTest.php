<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\DocYjsState;
use App\Services\Collab\CollabExternalWrite;
use App\Storage\WgwStorage;
use Tests\Feature\Drive\Concerns\SharedWorkspaceFixture;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1517: a grantee's onExists=replace moves the old document to the owner's
 * trash (D5). The Docs state stays at the path, so the upload is detected.
 */
final class DocsJmapReplaceGranteeTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithFileNodeJmap;
    use SharedWorkspaceFixture;

    private const SIDECAR_KEY = 'users/alice/workspace/.plan.md.yjs';

    public function test_a_grantee_replace_keeps_the_docs_state_at_the_path(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put(self::SIDECAR_KEY, 'plan-history');
        $blobId = $this->uploadFileNodeBlob("# Uploaded plan\n", 'bob', $this->token('editor'), 'text/markdown');

        $this->fileNodeJmap([
            ['FileNode/set', [
                'accountId' => 'bob',
                'onExists' => 'replace',
                'create' => ['f0' => ['parentId' => $this->workspaceNodeId(), 'name' => 'plan.md', 'blobId' => $blobId]],
            ], 'c0'],
        ], $this->token('editor'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.created.f0.name', 'plan.md');

        $this->assertSame("# Uploaded plan\n", $disk->read('users/alice/workspace/plan.md'));
        $this->assertSame(self::PLAN_BODY, $disk->read('users/alice/.Trash/plan.md'));
        $this->assertSame('plan-history', $disk->read(self::SIDECAR_KEY));
        $row = DocYjsState::query()->where('storage_key', 'users/alice/workspace/plan.md')->sole();
        $this->assertSame(hash('sha256', self::PLAN_BODY), $row->content_etag);
        $this->withBearer($this->token('editor'))
            ->get('/api/v1/files/collaboration?path='.urlencode(self::PLAN).'&format=yjs')
            ->assertOk()
            ->assertHeader(CollabExternalWrite::HEADER, '1');
    }
}
