<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Storage\WgwStorage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

/** Who a file is shared with sees its tags, and edits them at edit level (#2402). */
final class JmapFileNodeTagsShareTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithFileNodeJmap;

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

    private function shareWithAlice(string $path, string $access): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => $access]],
        ])->assertOk();
    }

    /**
     * @param  array<string, list<string>>  $update
     * @return array<string, mixed>
     */
    private function aliceTags(string $nodeId, array $update, string $token): array
    {
        return $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'alice', 'update' => [$nodeId => $update]], 'c0'],
        ], $token)->assertOk()->json('methodResponses.0.1');
    }

    public function test_a_person_shared_with_at_edit_level_sees_and_edits_the_tags(): void
    {
        app(WgwStorage::class)->files()->put('users/bob/plan.txt', 'a');
        $id = $this->fileNodeIdByName($this->fileNodeGetAll(), 'plan.txt');
        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$id => ['tagsAdd' => ['owner-tag']]]], 'c0'],
        ])->assertOk();
        $alice = $this->issueBearerTokenFor('alice');
        $this->shareWithAlice('/users/bob/plan.txt', 'edit');
        $this->assertSame(['owner-tag'], $this->fileNodeGetAll('alice', $alice)[$id]['tags']);

        $result = $this->aliceTags($id, ['tagsAdd' => ['from-alice'], 'tagsRemove' => ['owner-tag']], $alice);
        $this->assertSame(['from-alice'], $result['updated'][$id]['tags']);
        $this->assertSame(['from-alice'], $this->fileNodeGetAll()[$id]['tags']);
    }

    public function test_a_person_shared_with_at_view_level_sees_but_cannot_edit_the_tags(): void
    {
        app(WgwStorage::class)->files()->put('users/bob/read-only.txt', 'a');
        $id = $this->fileNodeIdByName($this->fileNodeGetAll(), 'read-only.txt');
        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$id => ['tagsAdd' => ['owner-tag']]]], 'c0'],
        ])->assertOk();
        $alice = $this->issueBearerTokenFor('alice');
        $this->shareWithAlice('/users/bob/read-only.txt', 'view');
        $this->assertSame(['owner-tag'], $this->fileNodeGetAll('alice', $alice)[$id]['tags']);
        $result = $this->aliceTags($id, ['tagsAdd' => ['sneaky']], $alice);

        $this->assertArrayHasKey($id, $result['notUpdated']);
        $this->assertSame(['owner-tag'], $this->fileNodeGetAll()[$id]['tags']);
    }
}
