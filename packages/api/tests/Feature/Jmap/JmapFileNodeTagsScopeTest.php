<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeTags;
use App\Storage\WgwStorage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\InteractsWithGuestUploads;
use Tests\Support\WgwDatabaseTestCase;

/** Tags stay in their space and never reach external callers (#2402). */
final class JmapFileNodeTagsScopeTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithFileNodeJmap;
    use InteractsWithGuestUploads;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config(['wgw.jmap.maintenance_share' => 0]);
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    private function tag(string $nodeId, string $tag): void
    {
        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$nodeId => ['tagsAdd' => [$tag]]]], 'c0'],
        ])->assertOk();
    }

    public function test_the_space_of_a_key_is_its_first_two_segments(): void
    {
        $this->assertSame('users/bob', FileNodeTags::spaceOf('users/bob/a/b.txt'));
        $this->assertSame('groups/team', FileNodeTags::spaceOf('groups/team'));
        $this->assertTrue(FileNodeTags::sameSpace('users/bob/a', 'users/bob/b/c'));
        $this->assertFalse(FileNodeTags::sameSpace('users/bob/a', 'groups/team/a'));
    }

    public function test_a_move_into_a_team_and_back_removes_the_tags(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/mine.txt', 'a');
        $this->seedGroupFile('theirs.txt');
        $nodes = $this->fileNodeGetAll();
        $mine = $this->fileNodeIdByName($nodes, 'mine.txt');
        $theirs = $this->fileNodeIdByName($nodes, 'theirs.txt');
        $this->tag($mine, 'personal-tag');
        $this->tag($theirs, 'team-tag');

        $index = app(FileNodeIndexService::class);
        $disk->move('users/bob/mine.txt', 'groups/team/mine.txt');
        $index->recordMove('users/bob/mine.txt', 'groups/team/mine.txt');
        $disk->move('groups/team/theirs.txt', 'users/bob/theirs.txt');
        $index->recordMove('groups/team/theirs.txt', 'users/bob/theirs.txt');

        $after = $this->fileNodeGetAll();
        $this->assertSame([], $after[$mine]['tags']);
        $this->assertSame([], $after[$theirs]['tags']);
    }

    public function test_a_move_inside_one_space_keeps_the_tags(): void
    {
        $disk = app(WgwStorage::class)->files();
        $this->seedGroupFile('a.txt');
        $disk->put('groups/team/sub/.keep', '');
        $id = $this->fileNodeIdByName($this->fileNodeGetAll(), 'a.txt');
        $this->tag($id, 'team-tag');

        $disk->move('groups/team/a.txt', 'groups/team/sub/a.txt');
        app(FileNodeIndexService::class)->recordMove('groups/team/a.txt', 'groups/team/sub/a.txt');

        $this->assertSame(['team-tag'], $this->fileNodeGetAll()[$id]['tags']);
    }

    public function test_a_copy_into_another_space_does_not_carry_the_tags(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/src.txt', 'a');
        $id = $this->fileNodeIdByName($this->fileNodeGetAll(), 'src.txt');
        $this->tag($id, 'personal-tag');

        $disk->copy('users/bob/src.txt', 'groups/team/src.txt');
        $copy = app(FileNodeIndexService::class)->recordCopy('users/bob/src.txt', 'groups/team/src.txt');

        $this->assertNotNull($copy);
        $this->assertSame([], $this->fileNodeGetAll()[(string) $copy->node_id]['tags']);
        $this->assertSame(['personal-tag'], $this->fileNodeGetAll()[$id]['tags']);
    }

    public function test_an_external_guest_never_sees_tags_and_cannot_filter_by_them(): void
    {
        $this->createDriveDirectory('/users/bob', 'inbox');
        app(WgwStorage::class)->files()->put('users/bob/inbox/shared.txt', 'a');
        $id = $this->fileNodeIdByName($this->fileNodeGetAll(), 'shared.txt');
        $this->tag($id, 'internal-only');

        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $get = $this->guestMethod($guest, $accountId, 'FileNode/get', ['ids' => [$id]]);

        $this->assertSame($id, $get['list'][0]['id']);
        $this->assertArrayNotHasKey('tags', $get['list'][0]);
        $query = $this->guestMethod($guest, $accountId, 'FileNode/query', ['filter' => ['isTopLevel' => true, 'hasTag' => 'internal-only']]);
        $this->assertSame('error', $query['_name']);
        $this->assertSame('invalidArguments', $query['type']);
    }
}
