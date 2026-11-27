<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapFileNode;
use App\Services\Drive\DriveShareRevoker;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeSyncState;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Share flags on FileNode (#2063 chunk S3): `FileNode/get` returns the caller's
 * share badges from one batch lookup, and every share write bumps the node so
 * `FileNode/changes` reports it.
 */
final class JmapFileNodeShareFlagsTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const NONE = ['hasShares' => false, 'hasPublicShare' => false, 'hasTeamShare' => false];

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

    public function test_get_returns_share_flags_for_the_owner(): void
    {
        $this->seedPrivateFile('bob', 'public.md');
        $this->seedPrivateFile('bob', 'team.md');
        $this->seedPrivateFile('bob', 'both.md');
        $this->seedPrivateFile('bob', 'plain.md');
        $this->createShare('/users/bob/public.md', 'public');
        $this->createShare('/users/bob/team.md', 'member', ['alice' => ['access' => 'view']]);
        $this->createShare('/users/bob/both.md', 'public');
        $this->createShare('/users/bob/both.md', 'member', ['alice' => ['access' => 'edit']]);

        $byName = $this->getByName(['public.md', 'team.md', 'both.md', 'plain.md'], ['name', 'shareFlags']);

        $this->assertSame(['hasShares' => true, 'hasPublicShare' => true, 'hasTeamShare' => false], $byName['public.md']['shareFlags']);
        $this->assertSame(['hasShares' => true, 'hasPublicShare' => false, 'hasTeamShare' => true], $byName['team.md']['shareFlags']);
        $this->assertSame(['hasShares' => true, 'hasPublicShare' => true, 'hasTeamShare' => true], $byName['both.md']['shareFlags']);
        $this->assertSame(self::NONE, $byName['plain.md']['shareFlags']);
    }

    /** The client (C1) asks with `properties: null` and relies on getting the flags. */
    public function test_get_without_properties_returns_share_flags(): void
    {
        $this->seedPrivateFile('bob', 'public.md');
        $this->seedPrivateFile('bob', 'plain.md');
        $this->createShare('/users/bob/public.md', 'public');
        $ids = [$this->idOf('public.md'), $this->idOf('plain.md')];

        $list = $this->jmap([['FileNode/get', ['accountId' => 'bob', 'ids' => $ids, 'properties' => null], 'g']])
            ->assertOk()->json('methodResponses.0.1.list');
        $byName = array_column($list, null, 'name');

        $this->assertSame(['hasShares' => true, 'hasPublicShare' => true, 'hasTeamShare' => false], $byName['public.md']['shareFlags']);
        $this->assertSame(self::NONE, $byName['plain.md']['shareFlags']);
    }

    public function test_share_flags_show_only_the_callers_own_shares(): void
    {
        $this->seedPrivateFile('bob', 'team.md');
        $this->createShare('/users/bob/team.md', 'member', ['alice' => ['access' => 'view']]);
        $id = $this->idOf('team.md');

        $list = $this->jmap([
            ['FileNode/get', ['accountId' => 'alice', 'ids' => [$id], 'properties' => ['shareFlags']], 'g'],
        ], $this->aliceToken())->assertOk()->json('methodResponses.0.1.list');

        $this->assertCount(1, $list);
        $this->assertSame(self::NONE, $list[0]['shareFlags']);
    }

    public function test_get_skips_the_share_lookup_when_share_flags_are_not_requested(): void
    {
        $this->seedPrivateFile('bob', 'public.md');
        $this->createShare('/users/bob/public.md', 'public');
        $id = $this->idOf('public.md');

        $this->assertSame(0, $this->indicatorQueries(fn () => $this->getIds([$id], ['name'])), 'a get without shareFlags must not run the share lookup');
        $this->assertArrayNotHasKey('shareFlags', $this->getIds([$id], ['name'])[0]);

        $this->assertSame(1, $this->indicatorQueries(fn () => $this->getIds([$id], ['shareFlags'])));
    }

    public function test_share_flags_lookup_does_not_grow_with_the_page(): void
    {
        $names = [];
        for ($i = 0; $i < 12; $i++) {
            $names[] = "f{$i}.md";
            $this->seedPrivateFile('bob', "f{$i}.md");
            $this->createShare("/users/bob/f{$i}.md", $i % 2 === 0 ? 'public' : 'member', $i % 2 === 0 ? null : ['alice' => ['access' => 'view']]);
        }
        $ids = array_map(fn (string $name): string => $this->idOf($name), $names);

        $few = $this->indicatorQueries(fn () => $this->getIds(array_slice($ids, 0, 2), ['shareFlags']));
        $many = $this->indicatorQueries(fn () => $this->getIds($ids, ['shareFlags']));

        $this->assertSame($few, $many, "share lookups grew with the page: {$few} for 2, {$many} for 12");
    }

    public function test_share_create_is_reported_by_changes(): void
    {
        $this->seedPrivateFile('bob', 'doc.md');
        $id = $this->idOf('doc.md');
        $state = app(FileNodeSyncState::class)->current('bob');

        $this->createShare('/users/bob/doc.md', 'public');

        $changes = $this->changes($state);
        $this->assertSame([$id], $changes['updated']);
        $this->assertSame([], $changes['created']);
        $this->assertSame([], $changes['destroyed']);
    }

    public function test_share_update_is_reported_by_changes(): void
    {
        $this->seedPrivateFile('bob', 'doc.md');
        $id = $this->idOf('doc.md');
        $share = $this->createShare('/users/bob/doc.md', 'member', ['alice' => ['access' => 'view']]);
        $state = app(FileNodeSyncState::class)->current('bob');

        $this->withBearer($this->userBearerToken())->patchJson('/api/v1/files/shares/'.$share['id'], [
            'updatedAt' => $share['updatedAt'],
            'defaultAccess' => 'edit',
        ])->assertOk();

        $this->assertSame([$id], $this->changes($state)['updated']);
    }

    public function test_share_revoke_is_reported_by_changes(): void
    {
        $this->seedPrivateFile('bob', 'doc.md');
        $id = $this->idOf('doc.md');
        $share = $this->createShare('/users/bob/doc.md', 'public');
        $state = app(FileNodeSyncState::class)->current('bob');

        $this->withBearer($this->userBearerToken())->deleteJson('/api/v1/files/shares/'.$share['id'])->assertSuccessful();

        $this->assertSame([$id], $this->changes($state)['updated']);
        $this->assertSame(self::NONE, $this->getByName(['doc.md'], ['name', 'shareFlags'])['doc.md']['shareFlags']);
    }

    public function test_revoke_all_public_is_reported_by_changes(): void
    {
        $this->seedPrivateFile('bob', 'Folder/a.md');
        $this->seedPrivateFile('bob', 'Folder/b.md');
        $a = $this->idOf('a.md');
        $b = $this->idOf('b.md');
        $this->createShare('/users/bob/Folder/a.md', 'public');
        $this->createShare('/users/bob/Folder/b.md', 'public');
        $state = app(FileNodeSyncState::class)->current('bob');

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares/public/revoke-all?path='.rawurlencode('/users/bob/Folder'))->assertOk();

        $updated = $this->changes($state)['updated'];
        sort($updated);
        $expected = [$a, $b];
        sort($expected);
        $this->assertSame($expected, $updated);
    }

    public function test_removed_grants_are_reported_by_changes(): void
    {
        $this->seedPrivateFile('bob', 'doc.md');
        $id = $this->idOf('doc.md');
        $this->createShare('/users/bob/doc.md', 'member', ['alice' => ['access' => 'view']]);
        $state = app(FileNodeSyncState::class)->current('bob');

        DB::connection('wgw')->transaction(fn () => app(DriveShareRevoker::class)->removeGrantsToUser('alice'));

        $this->assertSame([$id], $this->changes($state)['updated']);
        $this->assertSame(self::NONE, $this->getByName(['doc.md'], ['name', 'shareFlags'])['doc.md']['shareFlags']);
    }

    public function test_accepted_invite_is_reported_by_changes(): void
    {
        $this->seedPrivateFile('bob', 'doc.md');
        $id = $this->idOf('doc.md');
        $share = $this->createShare('/users/bob/doc.md', 'member');
        $invite = $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares/'.$share['id'].'/invites', [
            'email' => 'alice@example.test',
            'access' => 'view',
        ])->assertSuccessful();
        $this->assertSame(self::NONE, $this->getByName(['doc.md'], ['name', 'shareFlags'])['doc.md']['shareFlags'], 'a pending invite shows no badge');
        $state = app(FileNodeSyncState::class)->current('bob');

        $this->withBearer($this->aliceToken())->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => (string) $invite->json('data.inviteToken'),
        ])->assertOk();

        $this->assertSame([$id], $this->changes($state)['updated']);
        $this->assertTrue($this->getByName(['doc.md'], ['name', 'shareFlags'])['doc.md']['shareFlags']['hasTeamShare']);
    }

    public function test_removed_team_grants_are_reported_by_changes(): void
    {
        $this->seedPrivateFile('bob', 'doc.md');
        $id = $this->idOf('doc.md');
        $this->createShare('/users/bob/doc.md', 'member', ['groups/team' => ['access' => 'view']]);
        $this->assertTrue($this->getByName(['doc.md'], ['name', 'shareFlags'])['doc.md']['shareFlags']['hasTeamShare']);
        $seq = app(FileNodeIndexService::class)->currentSeq();

        DB::connection('wgw')->transaction(fn () => app(DriveShareRevoker::class)->removeGrantsToGroup('team'));

        // Bob is in the team, so his own grant went too and his state resets (cannotCalculateChanges);
        // the node bump is what tells every other member's device.
        $this->assertGreaterThan($seq, (int) JmapFileNode::query()->where('node_id', $id)->value('change_seq'));
        $this->assertSame(self::NONE, $this->getByName(['doc.md'], ['name', 'shareFlags'])['doc.md']['shareFlags']);
    }

    public function test_renamed_shared_file_is_reported_with_its_flags(): void
    {
        $this->seedPrivateFile('bob', 'doc.md');
        $id = $this->idOf('doc.md');
        $this->createShare('/users/bob/doc.md', 'public');
        $state = app(FileNodeSyncState::class)->current('bob');
        $seq = app(FileNodeIndexService::class)->currentSeq();

        $this->renameNode($id, 'renamed.md');

        $this->assertSame([$id], $this->changes($state)['updated']);
        $this->assertTrue($this->getIds([$id], ['shareFlags'])[0]['shareFlags']['hasPublicShare']);
        $this->assertBumpedAfterTheShareRowMoved($id, $seq);
    }

    public function test_shared_file_inside_a_renamed_folder_is_reported_with_its_flags(): void
    {
        $this->seedPrivateFile('bob', 'Folder/doc.md');
        $folder = $this->idOf('Folder');
        $file = $this->idOf('doc.md');
        $this->createShare('/users/bob/Folder/doc.md', 'public');
        $state = app(FileNodeSyncState::class)->current('bob');
        $seq = app(FileNodeIndexService::class)->currentSeq();

        $this->renameNode($folder, 'Moved');

        $updated = $this->changes($state)['updated'];
        sort($updated);
        $expected = [$folder, $file];
        sort($expected);
        $this->assertSame($expected, $updated);
        $this->assertTrue($this->getIds([$file], ['shareFlags'])[0]['shareFlags']['hasPublicShare']);
        $this->assertBumpedAfterTheShareRowMoved($file, $seq - 1);
    }

    public function test_capability_advertises_share_flags(): void
    {
        $session = $this->withBearer($this->userBearerToken())->getJson('/api/v1/jmap/session')->assertOk();

        $this->assertEquals((object) [], (object) $session->json('capabilities')[JmapCapabilities::FILENODE_SHARE_FLAGS]);
    }

    public function test_get_without_the_extension_in_using_has_no_share_flags(): void
    {
        $this->seedPrivateFile('bob', 'public.md');
        $this->createShare('/users/bob/public.md', 'public');
        $id = $this->idOf('public.md');

        $calls = [['FileNode/get', ['accountId' => 'bob', 'ids' => [$id]], 'g']];
        $this->assertSame(0, $this->indicatorQueries(fn () => $this->jmap($calls, null, [])->assertOk()));
        $node = $this->jmap($calls, null, [])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertArrayNotHasKey('shareFlags', $node);
    }

    /**
     * The rename bumps the node in recordMove, before the share row follows the new path; a sync
     * that read the node in between got empty flags. The share rewrite must bump it once more.
     */
    private function assertBumpedAfterTheShareRowMoved(string $id, int $seqBeforeRename): void
    {
        $seq = (int) JmapFileNode::query()->where('node_id', $id)->value('change_seq');
        $this->assertGreaterThan($seqBeforeRename + 1, $seq, 'the share rewrite did not bump the node after its row moved');
    }

    /**
     * @param  array<string, mixed>|null  $shareWith
     * @return array<string, mixed>
     */
    private function createShare(string $path, string $kind, ?array $shareWith = null): array
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => $kind,
            'defaultAccess' => 'view',
        ] + ($shareWith === null ? [] : ['shareWith' => $shareWith]))->assertOk()->json('data');
    }

    /**
     * @param  array<int, array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     * @param  list<string>  $extra
     * @return TestResponse<Response>
     */
    private function jmap(array $calls, ?string $token = null, array $extra = [JmapCapabilities::FILENODE_SHARE_FLAGS]): TestResponse
    {
        return $this->withBearer($token ?? $this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE, ...$extra],
            'methodCalls' => $calls,
        ]);
    }

    private function renameNode(string $id, string $name): void
    {
        $this->jmap([['FileNode/set', ['accountId' => 'bob', 'update' => [$id => ['name' => $name]]], 's']])
            ->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$id, null);
    }

    private function aliceToken(): string
    {
        return $this->issueBearerTokenFor('alice');
    }

    private function idOf(string $name): string
    {
        $list = $this->jmap([['FileNode/get', ['accountId' => 'bob', 'ids' => null, 'properties' => ['name']], 'g']])
            ->assertOk()->json('methodResponses.0.1.list');
        foreach ($list as $node) {
            if ($node['name'] === $name) {
                return (string) $node['id'];
            }
        }
        $this->fail('No node named '.$name);
    }

    /**
     * @param  list<string>  $names
     * @param  list<string>|null  $properties
     * @return array<string, array<string, mixed>>
     */
    private function getByName(array $names, ?array $properties): array
    {
        $ids = array_map(fn (string $name): string => $this->idOf($name), $names);
        $byName = [];
        foreach ($this->getIds($ids, $properties) as $node) {
            $byName[(string) $node['name']] = $node;
        }

        return $byName;
    }

    /**
     * @param  list<string>  $ids
     * @param  list<string>|null  $properties
     * @return list<array<string, mixed>>
     */
    private function getIds(array $ids, ?array $properties): array
    {
        $args = ['accountId' => 'bob', 'ids' => $ids] + ($properties === null ? [] : ['properties' => $properties]);

        return $this->jmap([['FileNode/get', $args, 'g']])->assertOk()->json('methodResponses.0.1.list');
    }

    /**
     * @return array{created: list<string>, updated: list<string>, destroyed: list<string>}
     */
    private function changes(string $state): array
    {
        return $this->jmap([['FileNode/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c']])
            ->assertOk()->json('methodResponses.0.1');
    }

    /** Runs of the batch share lookup (`DriveShareIndicators::forPaths`): drive_shares by owner and a path list. */
    private function indicatorQueries(callable $call): int
    {
        DB::connection('wgw')->enableQueryLog();
        DB::connection('wgw')->flushQueryLog();
        $call();
        $queries = DB::connection('wgw')->getQueryLog();
        DB::connection('wgw')->disableQueryLog();

        return count(array_filter(
            $queries,
            // SQLite quotes identifiers with "…", MySQL with `…`: compare without either.
            static fn (array $q): bool => preg_match(
                '/from\s+drive_shares\s+where\s+owner_username\s*=\s*\?\s+and\s+revoked_at\s+is\s+null\s+and\s+path\s+in/i',
                str_replace(['"', '`'], '', (string) $q['query']),
            ) === 1,
        ));
    }
}
