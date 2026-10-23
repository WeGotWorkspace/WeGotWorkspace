<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapFileNode;
use App\Models\Principal;
use App\Services\Jmap\Blobs\FreeSpaceSource;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * RFC 9425 Drive quotas (#1500): one quota per writable root, ids from the
 * root's node id, used = live file bytes under the root (trash included,
 * tombstones excluded), hardLimit = used + free, nothing when free space is
 * unknown.
 */
final class JmapQuotaTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const FREE = 1_000_000;

    /** @var object{free: int|null} */
    private object $freeSpace;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->freeSpace = new class implements FreeSpaceSource
        {
            public ?int $free = null;

            public function freeBytes(Filesystem $disk): ?int
            {
                return $this->free;
            }
        };
        $this->app->instance(FreeSpaceSource::class, $this->freeSpace);
        $this->fakeFreeSpace(self::FREE);
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    private function fakeFreeSpace(?int $free): void
    {
        // Mutated in place: the dispatcher (a singleton) keeps the instance
        // it was built with.
        $this->freeSpace->free = $free;
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     * @param  list<string>|null  $using
     */
    private function jmap(array $methodCalls, ?array $using = null, ?string $token = null): TestResponse
    {
        return $this->withBearer($token ?? $this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => $using ?? [JmapCapabilities::CORE, JmapCapabilities::FILENODE, JmapCapabilities::QUOTA],
            'methodCalls' => $methodCalls,
        ]);
    }

    /**
     * @return array<string, array<string, mixed>> keyed by quota name
     */
    private function quotasByName(): array
    {
        $list = $this->jmap([['Quota/get', ['accountId' => 'bob', 'ids' => null], 'q']])
            ->assertOk()
            ->json('methodResponses.0.1.list');
        $byName = [];
        foreach ($list as $quota) {
            $byName[$quota['name']] = $quota;
        }

        return $byName;
    }

    private function writeFile(string $key, string $contents): void
    {
        app(WgwStorage::class)->files()->put($key, $contents);
        app(FileNodeIndexService::class)->recordContentWrite($key, hash('sha256', $contents));
    }

    private function rootNodeId(string $key): string
    {
        $node = app(FileNodeIndexService::class)->liveByKey($key);
        $this->assertNotNull($node);

        return (string) $node->node_id;
    }

    public function test_session_advertises_quota_as_empty_objects(): void
    {
        $session = $this->withBearer($this->userBearerToken())->get('/api/v1/jmap/session')->assertOk();

        // Decoded as objects so an empty JSON object stays distinct from [].
        $document = json_decode((string) $session->getContent(), false, 512, JSON_THROW_ON_ERROR);
        $this->assertEquals(new \stdClass, $document->capabilities->{JmapCapabilities::QUOTA});
        $this->assertEquals(new \stdClass, $document->accounts->bob->accountCapabilities->{JmapCapabilities::QUOTA});
    }

    public function test_one_quota_per_writable_root_with_every_required_property(): void
    {
        $this->writeFile('users/bob/a.bin', str_repeat('a', 100));
        $this->writeFile('users/bob/dir/b.bin', str_repeat('b', 50));
        $this->writeFile('groups/team/c.bin', str_repeat('c', 70));

        $quotas = $this->quotasByName();

        $this->assertSame(['Personal drive', 'Team'], array_keys($quotas));
        $personal = $quotas['Personal drive'];
        $this->assertSame('dq-'.$this->rootNodeId('users/bob'), $personal['id']);
        $this->assertSame('octets', $personal['resourceType']);
        $this->assertSame(150, $personal['used']);
        $this->assertSame(150 + self::FREE, $personal['hardLimit']);
        $this->assertSame('account', $personal['scope']);
        $this->assertSame(['FileNode'], $personal['types']);

        // Group bytes are counted once, under the group quota.
        $this->assertSame(70, $quotas['Team']['used']);
        $this->assertSame('dq-'.$this->rootNodeId('groups/team'), $quotas['Team']['id']);
        foreach ($quotas as $quota) {
            $this->assertSame(self::FREE, $quota['hardLimit'] - $quota['used']);
        }
    }

    public function test_share_roots_and_other_users_roots_are_not_quotas(): void
    {
        app(WgwStorage::class)->files()->makeDirectory('users/alice/shared');
        $this->writeFile('users/alice/shared/x.bin', 'shared bytes');
        $this->withBearer($this->issueBearerTokenFor('alice'))->postJson('/api/v1/files/shares', [
            'path' => '/users/alice/shared',
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => ['carol' => ['access' => 'edit']],
        ])->assertOk();

        $list = $this->jmap(
            [['Quota/get', ['accountId' => 'carol', 'ids' => null], 'q']],
            token: $this->carolBearerToken(),
        )->assertOk()->json('methodResponses.0.1.list');

        // carol is in no group: only her personal drive.
        $this->assertCount(1, $list);
        $this->assertSame('Personal drive', $list[0]['name']);
        $this->assertSame('dq-'.$this->rootNodeId('users/carol'), $list[0]['id']);
    }

    public function test_tombstones_are_excluded_and_trash_is_included(): void
    {
        $this->writeFile('users/bob/keep.bin', str_repeat('k', 10));
        $this->writeFile('users/bob/gone.bin', str_repeat('g', 1000));
        app(WgwStorage::class)->files()->delete('users/bob/gone.bin');
        app(FileNodeIndexService::class)->recordDelete('users/bob/gone.bin');
        $this->assertTrue(JmapFileNode::query()->where('storage_key', 'users/bob/gone.bin')->whereNotNull('deleted_at')->exists());
        $this->writeFile('users/bob/.Trash/old.bin', str_repeat('t', 30));

        $this->assertSame(40, $this->quotasByName()['Personal drive']['used']);
    }

    public function test_a_lookalike_prefix_does_not_count_toward_another_root(): void
    {
        // `_` is a LIKE wildcard; it must be escaped in the prefix sum.
        $this->seedWgwUser('b_b', displayName: 'B');
        $this->writeFile('users/b_b/x.bin', str_repeat('x', 10));
        $this->writeFile('users/bxb/y.bin', str_repeat('y', 99));

        $list = $this->jmap(
            [['Quota/get', ['accountId' => 'b_b', 'ids' => null], 'q']],
            token: $this->issueBearerTokenFor('b_b'),
        )->assertOk()->json('methodResponses.0.1.list');

        $this->assertSame(10, $list[0]['used']);
    }

    public function test_ids_are_stable_across_a_group_rename(): void
    {
        $before = $this->quotasByName()['Team']['id'];

        // A group rename changes its display name (the slug is fixed in this
        // codebase); the quota id is the root node id, never name or slug.
        $group = Principal::query()->where('uri', 'principals/groups/team')->firstOrFail();
        $group->displayname = 'Renamed team';
        $group->save();

        $after = $this->quotasByName();
        $this->assertArrayNotHasKey('Team', $after);
        $this->assertSame($before, $after['Renamed team']['id']);
        $this->assertSame('dq-'.$this->rootNodeId('groups/team'), $before);
    }

    public function test_unknown_free_space_returns_no_quota(): void
    {
        $this->fakeFreeSpace(null);

        $response = $this->jmap([['Quota/get', ['accountId' => 'bob', 'ids' => null], 'q']])->assertOk();
        $this->assertSame([], $response->json('methodResponses.0.1.list'));
    }

    public function test_drive_quota_needs_filenode_in_using(): void
    {
        $response = $this->jmap(
            [['Quota/get', ['accountId' => 'bob', 'ids' => null], 'q']],
            [JmapCapabilities::CORE, JmapCapabilities::QUOTA],
        )->assertOk();

        $this->assertSame([], $response->json('methodResponses.0.1.list'));
    }

    public function test_get_by_id_reports_not_found(): void
    {
        $id = $this->quotasByName()['Personal drive']['id'];

        $response = $this->jmap([['Quota/get', ['accountId' => 'bob', 'ids' => [$id, 'dq-missing'], 'properties' => ['used']], 'q']])
            ->assertOk();

        $this->assertSame([['id' => $id, 'used' => 0]], $response->json('methodResponses.0.1.list'));
        $this->assertSame(['dq-missing'], $response->json('methodResponses.0.1.notFound'));
    }

    public function test_changes_report_exactly_what_moved(): void
    {
        $state = $this->jmap([['Quota/get', ['accountId' => 'bob', 'ids' => null], 'q']])->json('methodResponses.0.1.state');
        $quotas = $this->quotasByName();

        $none = $this->jmap([['Quota/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c']])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([], $none['created']);
        $this->assertSame([], $none['updated']);
        $this->assertSame($state, $none['newState']);
        $this->assertNull($none['updatedProperties']);

        $this->writeFile('groups/team/new.bin', 'twelve bytes');
        $changes = $this->jmap([['Quota/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c']])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$quotas['Team']['id']], $changes['updated']);
        $this->assertSame([], $changes['destroyed']);
        $this->assertFalse($changes['hasMoreChanges']);

        // Free space moving (another tenant's write) updates every quota.
        $this->fakeFreeSpace(self::FREE - 1);
        $drift = $this->jmap([['Quota/changes', ['accountId' => 'bob', 'sinceState' => $changes['newState'], 'maxChanges' => 1], 'c']])->assertOk()->json('methodResponses.0.1');
        $this->assertCount(1, $drift['updated']);
        $this->assertTrue($drift['hasMoreChanges']);
        $rest = $this->jmap([['Quota/changes', ['accountId' => 'bob', 'sinceState' => $drift['newState']], 'c']])->assertOk()->json('methodResponses.0.1');
        $this->assertCount(1, $rest['updated']);
        $this->assertNotSame($drift['updated'], $rest['updated']);

        // Unknown free space destroys them.
        $this->fakeFreeSpace(null);
        $gone = $this->jmap([['Quota/changes', ['accountId' => 'bob', 'sinceState' => $rest['newState']], 'c']])->assertOk()->json('methodResponses.0.1');
        $this->assertEqualsCanonicalizing(array_column($quotas, 'id'), $gone['destroyed']);
    }

    public function test_changes_from_an_unknown_state_cannot_be_calculated(): void
    {
        $response = $this->jmap([['Quota/changes', ['accountId' => 'bob', 'sinceState' => 'garbage'], 'c']])->assertOk();

        $this->assertSame('error', $response->json('methodResponses.0.0'));
        $this->assertSame('cannotCalculateChanges', $response->json('methodResponses.0.1.type'));
    }

    public function test_query_filters_and_sorts_by_name_and_used(): void
    {
        $this->writeFile('groups/team/big.bin', str_repeat('b', 500));
        $this->writeFile('users/bob/small.bin', str_repeat('s', 5));
        $quotas = $this->quotasByName();
        $personal = $quotas['Personal drive']['id'];
        $team = $quotas['Team']['id'];

        $byUsedDesc = $this->jmap([['Quota/query', ['accountId' => 'bob', 'sort' => [['property' => 'used', 'isAscending' => false]], 'calculateTotal' => true], 'q']])
            ->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$team, $personal], $byUsedDesc['ids']);
        $this->assertSame(2, $byUsedDesc['total']);
        $this->assertFalse($byUsedDesc['canCalculateChanges']);

        $byName = $this->jmap([['Quota/query', ['accountId' => 'bob', 'sort' => [['property' => 'name']]], 'q']])
            ->assertOk()->json('methodResponses.0.1.ids');
        $this->assertSame([$personal, $team], $byName);

        $filtered = $this->jmap([['Quota/query', ['accountId' => 'bob', 'filter' => ['name' => 'tea', 'type' => 'FileNode', 'scope' => 'account', 'resourceType' => 'octets']], 'q']])
            ->assertOk()->json('methodResponses.0.1.ids');
        $this->assertSame([$team], $filtered);

        $paged = $this->jmap([['Quota/query', ['accountId' => 'bob', 'anchor' => $personal, 'anchorOffset' => 1, 'limit' => 1], 'q']])
            ->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$team], $paged['ids']);
        $this->assertSame(1, $paged['position']);

        $badSort = $this->jmap([['Quota/query', ['accountId' => 'bob', 'sort' => [['property' => 'hardLimit']]], 'q']])->assertOk();
        $this->assertSame('unsupportedSort', $badSort->json('methodResponses.0.1.type'));
        $badFilter = $this->jmap([['Quota/query', ['accountId' => 'bob', 'filter' => ['used' => '1']], 'q']])->assertOk();
        $this->assertSame('unsupportedFilter', $badFilter->json('methodResponses.0.1.type'));
    }

    public function test_query_changes_cannot_be_calculated(): void
    {
        $response = $this->jmap([['Quota/queryChanges', ['accountId' => 'bob', 'sinceQueryState' => 'x'], 'q']])->assertOk();

        $this->assertSame('cannotCalculateChanges', $response->json('methodResponses.0.1.type'));
    }
}
