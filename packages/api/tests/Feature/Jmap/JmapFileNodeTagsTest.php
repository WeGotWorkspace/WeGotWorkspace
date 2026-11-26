<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\WgwStorage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

/** Tags on file nodes (#2402): set, get, query, scope, move, copy, delete. */
final class JmapFileNodeTagsTest extends WgwDatabaseTestCase
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

    /** @param list<string> $add @param list<string> $remove */
    private function setTags(string $nodeId, array $add, array $remove = [], string $account = 'bob', ?string $token = null): array
    {
        $patch = [];
        if ($add !== []) {
            $patch['tagsAdd'] = $add;
        }
        if ($remove !== []) {
            $patch['tagsRemove'] = $remove;
        }

        return $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => $account, 'update' => [$nodeId => $patch]], 'c0'],
        ], $token)->assertOk()->json('methodResponses.0.1');
    }

    private function nodeId(string $name, string $account = 'bob', ?string $token = null): string
    {
        return $this->fileNodeIdByName($this->fileNodeGetAll($account, $token), $name);
    }

    public function test_add_remove_and_normalise_tags_on_a_personal_file(): void
    {
        $this->seedPrivateFile('bob', 'plan.txt');
        $id = $this->nodeId('plan.txt');

        $result = $this->setTags($id, ['Client-A', 'review', 'review']);
        $this->assertSame(['client-a', 'review'], $result['updated'][$id]['tags']);

        $result = $this->setTags($id, ['later'], ['REVIEW']);
        $this->assertSame(['client-a', 'later'], $result['updated'][$id]['tags']);
        $this->assertSame(['client-a', 'later'], $this->fileNodeGetAll()[$id]['tags']);
    }

    public function test_invalid_tags_are_refused(): void
    {
        $this->seedPrivateFile('bob', 'plan.txt');
        $id = $this->nodeId('plan.txt');

        foreach (['has space', 'digit1', str_repeat('a', 256)] as $bad) {
            $result = $this->setTags($id, [$bad]);
            $this->assertSame('invalidProperties', $result['notUpdated'][$id]['type'], $bad);
        }
        $this->assertSame([], $this->fileNodeGetAll()[$id]['tags']);
    }

    public function test_query_has_tag_finds_files_across_folders_and_skips_trash(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/top.txt', 'a');
        $disk->put('users/bob/deep/er/nested.txt', 'b');
        $disk->put('users/bob/untagged.txt', 'c');
        $disk->put('users/bob/.Trash/gone.txt', 'd');
        $top = $this->nodeId('top.txt');
        $nested = $this->nodeId('nested.txt');
        $gone = $this->nodeId('gone.txt');
        foreach ([$top, $nested, $gone] as $id) {
            $this->setTags($id, ['client']);
        }

        $ids = $this->fileNodeJmap([
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['hasTag' => 'Client']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        sort($ids);
        $expected = [$top, $nested];
        sort($expected);
        $this->assertSame($expected, $ids);
    }

    public function test_tag_list_counts_visible_nodes_only(): void
    {
        $this->seedPrivateFile('bob', 'one.txt');
        $this->seedPrivateFile('bob', 'two.txt');
        $this->seedPrivateFile('carol', 'secret.txt');
        $this->setTags($this->nodeId('one.txt'), ['shared-tag', 'only-one']);
        $this->setTags($this->nodeId('two.txt'), ['shared-tag']);
        $carol = $this->carolBearerToken();
        $this->setTags($this->nodeId('secret.txt', 'carol', $carol), ['carol-only'], account: 'carol', token: $carol);

        $list = $this->fileNodeJmap([
            ['FileNode/tags', ['accountId' => 'bob'], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $this->assertSame([
            ['tag' => 'only-one', 'count' => 1],
            ['tag' => 'shared-tag', 'count' => 2],
        ], $list);
    }

    public function test_team_file_tags_are_seen_by_members_and_hidden_from_outsiders(): void
    {
        $this->seedGroupFile('brief.txt');
        $id = $this->nodeId('brief.txt');
        $result = $this->setTags($id, ['client']);
        $this->assertSame(['client'], $result['updated'][$id]['tags']);

        $alice = $this->issueBearerTokenFor('alice');
        $this->assertSame(['client'], $this->fileNodeGetAll('alice', $alice)[$id]['tags']);

        $carol = $this->carolBearerToken();
        $this->assertArrayNotHasKey($id, $this->fileNodeGetAll('carol', $carol));
        $denied = $this->setTags($id, ['sneaky'], account: 'carol', token: $carol);
        $this->assertArrayHasKey($id, $denied['notUpdated']);
        $this->assertSame(['client'], $this->fileNodeGetAll()[$id]['tags']);
    }

    public function test_tags_survive_a_move_and_are_copied_and_dropped_with_the_file(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/move-me.txt', 'a');
        $disk->put('users/bob/dest/.keep', '');
        $nodes = $this->fileNodeGetAll();
        $id = $this->fileNodeIdByName($nodes, 'move-me.txt');
        $destId = $this->fileNodeIdByName($nodes, 'dest');
        $this->setTags($id, ['keep-me']);

        $moved = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$id => ['parentId' => $destId]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertArrayHasKey($id, $moved['updated']);
        $this->assertSame(['keep-me'], $this->fileNodeGetAll()[$id]['tags']);

        $index = app(FileNodeIndexService::class);
        $disk->copy('users/bob/dest/move-me.txt', 'users/bob/copy.txt');
        $copy = $index->recordCopy('users/bob/dest/move-me.txt', 'users/bob/copy.txt');
        $this->assertNotNull($copy);
        $this->assertNotSame($id, (string) $copy->node_id);
        $this->assertSame(['keep-me'], $this->fileNodeGetAll()[(string) $copy->node_id]['tags']);

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$id]], 'c0'],
        ])->assertOk();
        $this->assertDatabaseMissing('jmap_file_node_tags', ['node_id' => $id], 'wgw');
    }
}
