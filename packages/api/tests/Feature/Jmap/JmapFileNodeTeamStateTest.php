<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\GroupMember;
use App\Models\JmapFileNode;
use App\Models\Principal;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Push\JmapPushEventId;
use App\Storage\WgwStorage;
use Illuminate\Http\Request;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk S2 of #2063: the FileNode change state covers the account roots, so a Team join or
 * leave answers cannotCalculateChanges, and FileNode/changes reports a folder that moves into
 * the caller's sight together with every descendant. bob and alice are in `team`; carol is not.
 */
final class JmapFileNodeTeamStateTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithJmapEventSource;

    /** @var array<string, string> */
    private array $tokens = [];

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

    public function test_joining_a_team_changes_the_state(): void
    {
        $this->seedGroupFile('brief.md');
        $this->assertNotContains('brief.md', $this->names('carol'));
        $state = $this->state('carol');

        $this->seedSharedTeam('team', 'carol');
        $this->forgetRequestState();

        $this->assertNotSame($state, $this->state('carol'));
        $this->assertCannotCalculateChanges('carol', $state);
        // The resync the client then runs lists the Team's files.
        $this->assertContains('brief.md', $this->names('carol'));
    }

    public function test_leaving_a_team_changes_the_state(): void
    {
        $this->seedGroupFile('brief.md');
        $this->assertContains('brief.md', $this->names('bob'));
        $state = $this->state('bob');
        $seq = app(FileNodeIndexService::class)->currentSeq();

        $this->leave('bob', 'team');

        $this->assertSame($seq, app(FileNodeIndexService::class)->currentSeq());
        $this->assertNotSame($state, $this->state('bob'));
        $this->assertCannotCalculateChanges('bob', $state);
        $this->assertNotContains('brief.md', $this->names('bob'));
    }

    public function test_state_without_a_team_change_still_returns_a_delta(): void
    {
        $this->names('bob');
        $state = $this->state('bob');
        $this->seedGroupFile('later.md');
        app(FileNodeIndexService::class)->recordCreate('groups/team/later.md');

        $delta = $this->changes('bob', $state);
        $this->assertSame([(string) $this->nodeAt('groups/team/later.md')->node_id], $delta['created']);
        $this->assertSame($this->state('bob'), $delta['newState']);
    }

    public function test_old_state_format_is_cannot_calculate_changes(): void
    {
        $this->names('bob');
        $seq = app(FileNodeIndexService::class)->currentSeq();
        // The grant-only state of #1926, as main issued it before #2063.
        $grantOnly = $seq.'.'.JmapPushEventId::hash('FileNode', app(FileNodeAccountSupport::class)->memberGrantPairs('bob'));

        $this->assertCannotCalculateChanges('bob', $grantOnly);
        $this->assertCannotCalculateChanges('bob', (string) $seq);
        $this->assertCannotCalculateChanges('bob', $seq.'.not-a-hash');
    }

    public function test_push_state_follows_the_team_roots(): void
    {
        $stream = $this->readEventSource($this->token('carol'), 'FileNode');
        $this->assertNotNull($stream['id']);

        $this->seedSharedTeam('team', 'carol');
        $this->forgetRequestState();

        $changed = $this->changedStates(
            $this->readEventSource($this->token('carol'), 'FileNode', $stream['id']),
            'carol',
        );
        $this->assertSame(['FileNode'], array_keys($changed));
        // The pushed state carries the scope hash FileNode/get returns, so the client's changes
        // call works. (Listing roots can bump the sequence, so only the hash is compared.)
        $this->assertSame(explode('.', $this->state('carol'))[1], explode('.', $changed['FileNode'])[1]);
    }

    public function test_folder_moved_into_sight_reports_its_descendants(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/alice/Plans/a.md', 'a');
        $disk->put('users/alice/Plans/Q3/b.md', 'b');
        $index = app(FileNodeIndexService::class);
        $index->recordCreate('users/alice/Plans/Q3/b.md');
        $index->recordCreate('users/alice/Plans/a.md');
        $folderId = (string) $this->nodeAt('users/alice/Plans')->node_id;
        $expected = [
            $folderId,
            (string) $this->nodeAt('users/alice/Plans/a.md')->node_id,
            (string) $this->nodeAt('users/alice/Plans/Q3')->node_id,
            (string) $this->nodeAt('users/alice/Plans/Q3/b.md')->node_id,
        ];
        sort($expected);
        $this->names('bob');
        $teamId = (string) $this->nodeAt('groups/team')->node_id;
        $bobState = $this->state('bob');
        $aliceState = $this->state('alice');
        $carolState = $this->state('carol');

        $this->jmapAs('alice', [
            ['FileNode/set', ['accountId' => 'alice', 'update' => [
                $folderId => ['parentId' => $teamId],
            ]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$folderId, null);
        $this->assertTrue($disk->fileExists('groups/team/Plans/Q3/b.md'));

        $bob = $this->changes('bob', $bobState);
        $updated = $bob['updated'];
        sort($updated);
        $this->assertSame($expected, $updated);
        $this->assertSame([], $bob['created']);
        $this->assertSame([], $bob['destroyed']);

        // alice saw the subtree before and after: only the moved folder changed.
        $alice = $this->changes('alice', $aliceState);
        $this->assertSame([$folderId], $alice['updated']);
        $this->assertSame([], $alice['destroyed']);

        // carol sees neither alice's home nor the Team: nothing arrives for her.
        $carol = $this->changes('carol', $carolState);
        $this->assertSame([], $carol['updated']);
        $this->assertSame([], $carol['destroyed']);
    }

    public function test_folder_restored_from_trash_into_a_team_reports_its_descendants(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/alice/.Trash/Plans/a.md', 'a');
        $index = app(FileNodeIndexService::class);
        $index->recordCreate('users/alice/.Trash/Plans/a.md');
        $childId = (string) $this->nodeAt('users/alice/.Trash/Plans/a.md')->node_id;
        $folderId = (string) $this->nodeAt('users/alice/.Trash/Plans')->node_id;
        $this->names('bob');
        $bobState = $this->state('bob');

        $disk->move('users/alice/.Trash/Plans', 'groups/team/Plans');
        $index->recordMove('users/alice/.Trash/Plans', 'groups/team/Plans');

        $updated = $this->changes('bob', $bobState)['updated'];
        sort($updated);
        $expected = [$folderId, $childId];
        sort($expected);
        $this->assertSame($expected, $updated);
    }

    public function test_folder_moved_out_and_back_is_not_destroyed(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('groups/team/Plans/a.md', 'a');
        $index = app(FileNodeIndexService::class);
        $index->recordCreate('groups/team/Plans/a.md');
        $folderId = (string) $this->nodeAt('groups/team/Plans')->node_id;
        $this->names('bob');
        $bobState = $this->state('bob');

        $disk->move('groups/team/Plans', 'users/alice/Plans');
        $index->recordMove('groups/team/Plans', 'users/alice/Plans');
        $disk->move('users/alice/Plans', 'groups/team/Plans');
        $index->recordMove('users/alice/Plans', 'groups/team/Plans');

        $bob = $this->changes('bob', $bobState);
        // Visible at the old state and now: the children never left bob's tree.
        $this->assertSame([$folderId], $bob['updated']);
        $this->assertSame([], $bob['destroyed']);
    }

    public function test_node_moved_into_sight_and_deleted_is_not_reported_as_updated(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/alice/Plans/a.md', 'a');
        $index = app(FileNodeIndexService::class);
        $index->recordCreate('users/alice/Plans/a.md');
        $childId = (string) $this->nodeAt('users/alice/Plans/a.md')->node_id;
        $this->names('bob');
        $bobState = $this->state('bob');

        $disk->move('users/alice/Plans', 'groups/team/Plans');
        $index->recordMove('users/alice/Plans', 'groups/team/Plans');
        $disk->delete('groups/team/Plans/a.md');
        $index->recordDelete('groups/team/Plans/a.md');

        $bob = $this->changes('bob', $bobState);
        $this->assertNotContains($childId, $bob['updated']);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->withBearer($this->token($username))->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function state(string $username): string
    {
        return (string) $this->jmapAs($username, [
            ['FileNode/get', ['accountId' => $username, 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');
    }

    /**
     * Lists the account, which also indexes its roots and their children.
     *
     * @return list<string>
     */
    private function names(string $username): array
    {
        $list = $this->jmapAs($username, [
            ['FileNode/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        return array_values(array_map(static fn (array $node): string => (string) $node['name'], (array) $list));
    }

    /** @return array<string, mixed> the FileNode/changes response arguments */
    private function changes(string $username, string $sinceState): array
    {
        return (array) $this->jmapAs($username, [
            ['FileNode/changes', ['accountId' => $username, 'sinceState' => $sinceState], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.0', 'FileNode/changes')->json('methodResponses.0.1');
    }

    private function assertCannotCalculateChanges(string $username, string $sinceState): void
    {
        $this->jmapAs($username, [
            ['FileNode/changes', ['accountId' => $username, 'sinceState' => $sinceState], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }

    private function nodeAt(string $key): JmapFileNode
    {
        $node = app(FileNodeIndexService::class)->liveByKey($key);
        $this->assertNotNull($node, 'No live node at '.$key);

        return $node;
    }

    private function leave(string $username, string $team): void
    {
        GroupMember::query()
            ->where('principal_id', Principal::query()->where('uri', 'principals/groups/'.$team)->value('id'))
            ->where('member_id', Principal::forUsername($username)?->id)
            ->delete();
        $this->forgetRequestState();
    }

    private function forgetRequestState(): void
    {
        $this->app->instance('request', Request::create('/'));
    }

    private function token(string $username): string
    {
        return $this->tokens[$username] ??= $this->issueBearerTokenFor($username);
    }
}
