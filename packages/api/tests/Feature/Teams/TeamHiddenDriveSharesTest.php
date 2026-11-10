<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use App\Models\DriveShareGrant;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Testing\TestResponse;
use Tests\Support\DocsTestFixtures;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk E2 of Epic #1915 (#1926): a Drive or Docs share from someone who no longer shares a
 * Team with the grantee is hidden on read for both people, admins included, and comes back
 * when they share a Team again. Nothing is deleted. FileNode state carries a hash of the
 * caller's visible member grants, so a hidden or changed grant resets the sync.
 *
 * Personas: bob (owner) and carol share Team t1; alice is admin and shares t2 with carol.
 * bob and alice are both in `team` (Drive fixtures); carol is not.
 */
final class TeamHiddenDriveSharesTest extends WgwDatabaseTestCase
{
    use DocsTestFixtures;
    use InteractsWithJmapEventSource;

    private const FOLDER = '/users/bob/Projects';

    private const FILE = '/users/bob/Projects/plan.md';

    private const DOC = '/users/bob/docs/plan.md';

    private const THREAD = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAA';

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDocsFixtures();
        Cache::flush();
        $this->seedSharedTeam('t1', 'bob', 'carol');
        $this->seedSharedTeam('t2', 'alice', 'carol');
        $this->createDriveDirectory('/users/bob', 'Projects');
        $this->createDriveFile($this->token('bob'), self::FOLDER, 'plan.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDocsFixtures();
        parent::tearDown();
    }

    public function test_a_drive_share_is_hidden_for_both_when_they_share_no_team_and_comes_back(): void
    {
        $shareId = $this->share('bob', self::FOLDER, ['carol' => 'view']);
        $this->assertSharedWithCarol($shareId);
        $carolState = $this->fileNodeState('carol');
        $rows = $this->grantRowSnapshot();

        $this->leave('carol', 't1');

        $this->assertSame([], $this->sharedWithMePaths('carol'));
        $hidden = $this->asUser('carol')->get('/api/v1/files/content?path='.urlencode(self::FILE));
        $unknown = $this->asUser('carol')->get('/api/v1/files/content?path='.urlencode('/users/bob/Projects/missing.md'));
        $hidden->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->assertSame($unknown->json(), $hidden->json());
        $this->assertNotContains('Projects', $this->fileNodeNames('carol'));
        $this->assertCannotCalculateChanges('carol', $carolState);
        $this->asUser('bob')->getJson('/api/v1/files/shares/'.$shareId)->assertOk()
            ->assertJsonMissingPath('data.shareWith.carol');
        $this->assertNotContains('carol', $this->effectiveGrantees('bob', self::FILE));
        $this->assertSame([], $this->byPrincipalPaths('bob', 'carol'));
        $this->assertSame($rows, $this->grantRowSnapshot());

        $this->join('carol', 't1');

        $this->assertSharedWithCarol($shareId);
        $this->assertSame($rows, $this->grantRowSnapshot());
    }

    public function test_a_team_grant_is_hidden_when_its_owner_leaves_that_team_even_for_a_member_who_shares_another_team(): void
    {
        // Bob and carol share T1 and T3; the folder goes to T3. The grant is judged per grant:
        // once bob leaves T3 carol loses it although she still shares T1 with him.
        $this->seedSharedTeam('t3', 'bob', 'carol');
        $this->forgetRequestState();
        $shareId = $this->share('bob', self::FOLDER, ['groups/t3' => 'view']);
        $this->assertSame([self::FOLDER], $this->sharedWithMePaths('carol'));
        $this->asUser('carol')->get('/api/v1/files/content?path='.urlencode(self::FILE))->assertOk();
        $this->asUser('bob')->getJson('/api/v1/files/shares/'.$shareId)->assertOk()
            ->assertJsonPath('data.shareWith.groups/t3.access', 'view');
        $rows = $this->grantRowSnapshot();

        $this->leave('bob', 't3');

        $this->assertTeamGrantHidden($shareId);
        $this->assertSame($rows, $this->grantRowSnapshot());

        // Sharing yet another Team does not bring it back; only bob rejoining T3 does.
        $this->seedSharedTeam('t4', 'bob', 'carol');
        $this->forgetRequestState();
        $this->assertTeamGrantHidden($shareId);

        $this->join('bob', 't3');

        $this->assertSame([self::FOLDER], $this->sharedWithMePaths('carol'));
        $this->asUser('carol')->get('/api/v1/files/content?path='.urlencode(self::FILE))->assertOk();
        $this->asUser('bob')->getJson('/api/v1/files/shares/'.$shareId)->assertOk()
            ->assertJsonPath('data.shareWith.groups/t3.access', 'view');
        $this->assertSame($rows, $this->grantRowSnapshot());
    }

    public function test_the_owners_listing_drops_the_shared_badge_while_the_only_grant_is_hidden(): void
    {
        $this->share('bob', self::FOLDER, ['carol' => 'view']);
        $this->assertSame(['hasShares' => true, 'hasTeamShare' => true], $this->shareBadges('bob'));

        $this->leave('carol', 't1');
        $this->assertSame(['hasShares' => false, 'hasTeamShare' => false], $this->shareBadges('bob'));

        $this->join('carol', 't1');
        $this->assertSame(['hasShares' => true, 'hasTeamShare' => true], $this->shareBadges('bob'));
    }

    public function test_a_file_an_admin_shared_with_someone_outside_the_admins_teams_is_hidden_for_both(): void
    {
        $this->createDriveDirectory('/users/alice', 'Board');
        $shareId = $this->share('alice', '/users/alice/Board', ['carol' => 'view']);
        $this->assertSame(['/users/alice/Board'], $this->sharedWithMePaths('carol'));

        $this->leave('carol', 't2');

        $this->assertSame([], $this->sharedWithMePaths('carol'));
        $this->assertNotContains('Board', $this->fileNodeNames('carol'));
        $this->asUser('alice')->getJson('/api/v1/files/shares/'.$shareId)->assertOk()
            ->assertJsonMissingPath('data.shareWith.carol');
        $this->assertNotContains('carol', $this->effectiveGrantees('alice', '/users/alice/Board'));
    }

    public function test_a_patch_keeps_the_hidden_grant_and_revoking_the_share_ends_it(): void
    {
        $shareId = $this->share('bob', self::FOLDER, ['carol' => 'view', 'alice' => 'view']);
        $this->leave('carol', 't1');
        $carolGrant = $this->carolGrantRow();
        $count = DriveShareGrant::query()->count();

        $updatedAt = (string) $this->asUser('bob')->getJson('/api/v1/files/shares/'.$shareId)->assertOk()->json('data.updatedAt');
        $this->asUser('bob')->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk()
            ->assertJsonPath('data.shareWith.alice.access', 'edit')
            ->assertJsonMissingPath('data.shareWith.carol');

        $this->assertSame($carolGrant, $this->carolGrantRow());
        $this->assertSame($count, DriveShareGrant::query()->count());

        $this->asUser('bob')->deleteJson('/api/v1/files/shares/'.$shareId)->assertOk();
        $this->join('carol', 't1');

        $this->assertSame([], $this->sharedWithMePaths('carol'));
        $this->assertSame($count, DriveShareGrant::query()->count());
    }

    public function test_hiding_one_of_two_grants_on_the_same_root_resets_file_node_sync_and_pushes(): void
    {
        $this->seedSharedTeam('g2', 'bob', 'carol');
        $this->forgetRequestState();
        $this->share('bob', self::FOLDER, ['carol' => 'view', 'groups/g2' => 'edit']);
        $state = $this->fileNodeState('carol');
        $stream = $this->readEventSource($this->token('carol'), 'FileNode');
        $seq = app(FileNodeIndexService::class)->currentSeq();

        $this->leave('bob', 'g2');

        $this->assertSame($seq, app(FileNodeIndexService::class)->currentSeq());
        $this->assertContains('Projects', $this->fileNodeNames('carol'));
        $this->assertCannotCalculateChanges('carol', $state);
        $this->assertSame(
            ['FileNode'],
            array_keys($this->changedStates($this->readEventSource($this->token('carol'), 'FileNode', $stream['id']), 'carol')),
        );
    }

    public function test_changing_a_grant_from_read_to_readwrite_resets_file_node_sync_and_pushes(): void
    {
        $shareId = $this->share('bob', self::FOLDER, ['carol' => 'view']);
        $state = $this->fileNodeState('carol');
        $stream = $this->readEventSource($this->token('carol'), 'FileNode');
        $seq = app(FileNodeIndexService::class)->currentSeq();

        $updatedAt = (string) $this->asUser('bob')->getJson('/api/v1/files/shares/'.$shareId)->assertOk()->json('data.updatedAt');
        $this->asUser('bob')->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'shareWith' => ['carol' => ['access' => 'edit']],
        ])->assertOk();

        $this->assertSame($seq, app(FileNodeIndexService::class)->currentSeq());
        $this->assertCannotCalculateChanges('carol', $state);
        $this->assertSame(
            ['FileNode'],
            array_keys($this->changedStates($this->readEventSource($this->token('carol'), 'FileNode', $stream['id']), 'carol')),
        );
    }

    public function test_after_a_resync_the_state_carries_the_grant_hash_and_changes_return_a_delta(): void
    {
        $this->share('bob', self::FOLDER, ['carol' => 'view']);
        $responses = $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => 'carol', 'ids' => []], 'c0'],
            ['FileNode/query', ['accountId' => 'carol'], 'c1'],
        ], $this->token('carol'))->assertOk();
        $state = (string) $responses->json('methodResponses.0.1.state');
        $this->assertMatchesRegularExpression('/^\d+\.[0-9a-f]{32}$/', $state);
        $this->assertSame($state, $responses->json('methodResponses.1.1.queryState'));

        $this->createDriveFile($this->token('bob'), self::FOLDER, 'notes.md');

        $response = $this->fileNodeJmap([
            ['FileNode/changes', ['accountId' => 'carol', 'sinceState' => $state], 'c0'],
        ], $this->token('carol'))->assertOk()->assertJsonPath('methodResponses.0.0', 'FileNode/changes');
        $delta = (array) $response->json('methodResponses.0.1');
        $this->assertCount(1, $delta['created']);
        $this->assertMatchesRegularExpression('/^\d+\.[0-9a-f]{32}$/', (string) $delta['newState']);
    }

    public function test_a_legacy_digit_only_state_answers_cannot_calculate_changes(): void
    {
        $this->assertCannotCalculateChanges('carol', (string) app(FileNodeIndexService::class)->currentSeq());
    }

    public function test_thread_routes_on_a_hidden_doc_answer_like_an_unknown_doc(): void
    {
        $this->seedDocFile('bob', 'plan.md', "# Plan\n\nInitial");
        $this->share('bob', self::DOC, ['carol' => 'comment']);
        $this->asUser('bob')->postJson($this->threadsUrl(self::DOC), [
            'id' => self::THREAD,
            'kind' => 'comment',
            'body' => 'owner note',
            'anchorText' => 'Plan',
        ])->assertCreated();
        $this->asUser('carol')->getJson($this->threadsUrl(self::DOC))->assertOk();

        $this->leave('carol', 't1');

        foreach ([self::DOC, '/users/bob/docs/missing.md'] as $path) {
            $this->assertDocNotFound($this->asUser('carol')->getJson($this->threadsUrl($path)));
            $this->assertDocNotFound($this->asUser('carol')->getJson($this->threadsUrl($path, 'changes')));
            $this->assertDocNotFound($this->asUser('carol')->postJson($this->threadsUrl($path), [
                'id' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBAB',
                'kind' => 'comment',
                'body' => 'not allowed',
                'anchorText' => 'Plan',
            ]));
            $this->assertDocNotFound($this->asUser('carol')->postJson($this->threadsUrl($path, self::THREAD.'/replies'), [
                'id' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBAC',
                'body' => 'not allowed',
            ]));
        }
        $this->assertCount(1, (array) $this->asUser('bob')->getJson($this->threadsUrl(self::DOC))->assertOk()->json('list'));
    }

    public function test_a_live_collab_session_is_dropped_on_the_next_signaling_check(): void
    {
        $this->seedDocFile('bob', 'plan.md', "# Plan\n\nInitial");
        $this->share('bob', self::DOC, ['carol' => 'edit']);
        $room = '/api/v1/rooms/'.RoomTestHelper::fileRoomId(self::DOC);
        $peerId = (string) $this->asUser('carol')->postJson($room.'/participants', ['name' => 'Carol'])->assertOk()->json('peerId');
        $this->asUser('carol')->getJson($room.'/events?peerId='.$peerId)->assertOk();

        $this->leave('carol', 't1');

        $this->asUser('carol')->getJson($room.'/events?peerId='.$peerId)
            ->assertStatus(403)
            ->assertJson(['error' => 'forbidden']);
        $this->asUser('carol')->postJson($room.'/participants', ['name' => 'Carol'])->assertStatus(403);
    }

    public function test_public_links_and_email_grants_are_unaffected(): void
    {
        $this->share('bob', self::FOLDER, ['carol' => 'view', 'guest@example.com' => 'view']);
        $public = $this->asUser('bob')->postJson('/api/v1/files/shares', [
            'path' => self::FOLDER,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $this->leave('carol', 't1');

        $this->assertContains('guest@example.com', $this->effectiveGrantees('bob', self::FILE));
        $guest = (string) $this->postJson('/api/v1/files/share-sessions', [
            'token' => (string) $public->json('data.publicToken'),
        ])->assertOk()->json('access_token');
        $this->withBearer($guest)->getJson('/api/v1/files/children?path='.urlencode(self::FOLDER))->assertOk();
    }

    /**
     * @param  array<string, string>  $grantees
     */
    private function share(string $owner, string $path, array $grantees): string
    {
        $shareWith = [];
        foreach ($grantees as $grantee => $access) {
            $shareWith[$grantee] = ['access' => $access];
        }

        return (string) $this->asUser($owner)->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => $shareWith,
        ])->assertOk()->json('data.id');
    }

    private function assertSharedWithCarol(string $shareId): void
    {
        $this->assertSame([self::FOLDER], $this->sharedWithMePaths('carol'));
        $this->asUser('carol')->get('/api/v1/files/content?path='.urlencode(self::FILE))->assertOk();
        $this->assertContains('Projects', $this->fileNodeNames('carol'));
        $this->asUser('bob')->getJson('/api/v1/files/shares/'.$shareId)->assertOk()
            ->assertJsonPath('data.shareWith.carol.access', 'view');
        $this->assertContains('carol', $this->effectiveGrantees('bob', self::FILE));
        $this->assertSame([self::FOLDER], $this->byPrincipalPaths('bob', 'carol'));
    }

    private function assertTeamGrantHidden(string $shareId): void
    {
        $this->assertSame([], $this->sharedWithMePaths('carol'));
        $this->asUser('carol')->get('/api/v1/files/content?path='.urlencode(self::FILE))->assertNotFound();
        $this->asUser('bob')->getJson('/api/v1/files/shares/'.$shareId)->assertOk()
            ->assertJsonMissingPath('data.shareWith.groups/t3');
    }

    /**
     * @return array{hasShares: bool, hasTeamShare: bool}
     */
    private function shareBadges(string $owner): array
    {
        $entry = collect((array) $this->asUser($owner)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertOk()->json('data.files'))->firstWhere('name', 'Projects');
        $this->assertIsArray($entry);

        return [
            'hasShares' => (bool) ($entry['hasShares'] ?? false),
            'hasTeamShare' => (bool) ($entry['hasTeamShare'] ?? false),
        ];
    }

    /**
     * @return list<string>
     */
    private function sharedWithMePaths(string $username): array
    {
        return array_values(array_map(
            static fn (array $row): string => (string) $row['share']['path'],
            (array) $this->asUser($username)->getJson('/api/v1/files/shared-with-me')->assertOk()->json('data'),
        ));
    }

    /**
     * @return list<string>
     */
    private function effectiveGrantees(string $owner, string $path): array
    {
        return array_values(array_map(
            static fn (array $row): string => (string) $row['principal'],
            (array) $this->asUser($owner)->getJson('/api/v1/files/shares/at-path?path='.urlencode($path))
                ->assertOk()->json('data.effectiveGrants'),
        ));
    }

    /**
     * @return list<string>
     */
    private function byPrincipalPaths(string $owner, string $principal): array
    {
        return array_values(array_map(
            static fn (array $row): string => (string) $row['source']['sharePath'],
            (array) $this->asUser($owner)->getJson('/api/v1/files/shares/by-principal?principal='.urlencode($principal))
                ->assertOk()->json('data.entries'),
        ));
    }

    /**
     * @return list<string>
     */
    private function fileNodeNames(string $username): array
    {
        return array_values(array_map(
            static fn (array $node): string => (string) $node['name'],
            $this->fileNodeGetAll($username, $this->token($username)),
        ));
    }

    private function fileNodeState(string $username): string
    {
        return (string) $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => $username, 'ids' => []], 'c0'],
        ], $this->token($username))->assertOk()->json('methodResponses.0.1.state');
    }

    private function assertCannotCalculateChanges(string $username, string $sinceState): void
    {
        $this->fileNodeJmap([
            ['FileNode/changes', ['accountId' => $username, 'sinceState' => $sinceState], 'c0'],
        ], $this->token($username))->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }

    /**
     * @return array<string, mixed>
     */
    private function carolGrantRow(): array
    {
        $grant = DriveShareGrant::query()->where('grantee_type', 'user')->where('grantee_user', 'carol')->firstOrFail();

        return $grant->getAttributes();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function grantRowSnapshot(): array
    {
        return DriveShareGrant::query()->orderBy('id')->get()->map->getAttributes()->all();
    }

    private function assertDocNotFound(TestResponse $response): void
    {
        $response->assertNotFound()
            ->assertJsonPath('code', 'not_found')
            ->assertJsonPath('error', 'Document not found.');
    }

    private function threadsUrl(string $path, ?string $suffix = null): string
    {
        return '/api/v1/files/threads'.($suffix !== null ? '/'.$suffix : '').'?path='.urlencode($path);
    }

    private function leave(string $username, string $team): void
    {
        GroupMember::query()
            ->where('principal_id', Principal::query()->where('uri', 'principals/groups/'.$team)->value('id'))
            ->where('member_id', Principal::forUsername($username)?->id)
            ->delete();
        $this->forgetRequestState();
    }

    private function join(string $username, string $team): void
    {
        $this->seedSharedTeam($team, $username);
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

    private function asUser(string $username): static
    {
        return $this->withBearer($this->token($username));
    }
}
