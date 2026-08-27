<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarShareDismissal;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Tasks\InboxTaskListProvisioner;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * REST PATCH shareWith + task ACL on shared VTODO collections (Task #650 / Chunk A).
 */
final class TasksTaskListsShareWithTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedInboxTaskListFor('alice');
        $team = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Team');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);
    }

    public function test_owner_can_share_personal_list_read_only(): void
    {
        $listId = $this->createPersonalList('bob', 'Shared Projects');

        $owner = $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, [
                'shareWith' => ['alice' => ['mayReadItems' => true]],
            ])
            ->assertOk();
        $shareWith = $owner->json('shareWith');
        $this->assertIsArray($shareWith['alice'] ?? null);
        $this->assertFalse($shareWith['alice']['mayWrite'] ?? $shareWith['alice']['mayWriteAll'] ?? true);
        $this->assertFalse($shareWith['alice']['mayShare']);

        $shared = $this->listNamed('alice', 'Shared Projects');
        $this->assertNotSame($listId, $shared['id']);
        $this->assertNull($shared['shareWith']);
        $this->assertTrue($shared['isSharee']);
        $this->assertFalse($shared['myRights']['mayShare']);
        $this->assertFalse($shared['myRights']['mayWriteAll']);
        $this->assertTrue($shared['myRights']['mayReadItems']);
    }

    public function test_shared_inbox_is_not_recipient_default(): void
    {
        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.InboxTaskListProvisioner::URI, [
                'shareWith' => ['alice' => ['mayWriteAll' => true]],
            ])
            ->assertOk()
            ->assertJsonPath('role', 'inbox')
            ->assertJsonPath('isDefault', true);

        $lists = collect($this->asUser('alice')->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list'));

        $ownInbox = $lists->first(
            static fn (array $row): bool => ($row['role'] ?? null) === 'inbox' && ($row['isDefault'] ?? false) === true
        );
        $this->assertIsArray($ownInbox);
        $this->assertSame(InboxTaskListProvisioner::URI, $ownInbox['id']);
        $this->assertFalse($ownInbox['isSharee']);

        $sharedInbox = $lists->first(
            static fn (array $row): bool => ($row['isSharee'] ?? false) === true && ($row['name'] ?? '') === InboxTaskListProvisioner::DISPLAY_NAME
        );
        $this->assertIsArray($sharedInbox);
        $this->assertTrue($sharedInbox['isSharee']);
        $this->assertNotSame('inbox', $sharedInbox['role']);
        $this->assertFalse($sharedInbox['isDefault']);
        $this->assertNull($sharedInbox['shareWith']);
        $this->assertFalse($sharedInbox['myRights']['mayShare']);
        $sharedInboxId = (string) $sharedInbox['id'];

        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.InboxTaskListProvisioner::URI, [
                'shareWith' => ['alice' => null],
            ])
            ->assertOk()
            ->assertJsonPath('shareWith', null);

        $afterRevoke = collect($this->asUser('alice')->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list'));

        $ownInboxAfter = $afterRevoke->first(
            static fn (array $row): bool => ($row['role'] ?? null) === 'inbox' && ($row['isDefault'] ?? false) === true
        );
        $this->assertIsArray($ownInboxAfter);
        $this->assertSame(InboxTaskListProvisioner::URI, $ownInboxAfter['id']);
        $this->assertFalse($ownInboxAfter['isSharee']);

        $this->assertNull(
            $afterRevoke->first(
                static fn (array $row): bool => ($row['id'] ?? null) === $sharedInboxId
                    || (($row['isSharee'] ?? false) === true && ($row['name'] ?? '') === InboxTaskListProvisioner::DISPLAY_NAME)
            ),
            'Expected the shared Inbox to disappear after revoke',
        );
    }

    public function test_read_share_denies_task_create_update_and_delete(): void
    {
        $listId = $this->createPersonalList('bob', 'Read Only Share');
        $this->shareList('bob', $listId, 'alice', write: false);
        $sharedId = (string) $this->listNamed('alice', 'Read Only Share')['id'];

        $ownerTaskId = (string) $this->asUser('bob')
            ->postJson('/api/v1/tasks/items', [
                'taskListIds' => [$listId => true],
                'title' => 'Owner task',
            ])
            ->assertCreated()
            ->json('id');

        $this->asUser('alice')
            ->getJson('/api/v1/tasks/items/'.$ownerTaskId)
            ->assertOk()
            ->assertJsonPath('title', 'Owner task');

        $this->asUser('alice')
            ->postJson('/api/v1/tasks/items', [
                'taskListIds' => [$sharedId => true],
                'title' => 'Should fail',
            ])
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');

        $taskUrl = '/api/v1/tasks/items/'.$ownerTaskId;
        $etag = $this->fetchEtagFromGetAs('alice', $taskUrl);

        $this->asUser('alice')
            ->patchJson($taskUrl, ['title' => 'Hijacked'], $this->withIfMatch($etag))
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');

        $this->asUser('alice')
            ->deleteJson($taskUrl, [], $this->withIfMatch($etag))
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }

    public function test_write_share_allows_task_create_update_and_delete(): void
    {
        $listId = $this->createPersonalList('bob', 'Write Share');
        $this->shareList('bob', $listId, 'alice', write: true);
        $sharedId = (string) $this->listNamed('alice', 'Write Share')['id'];

        $taskId = (string) $this->asUser('alice')
            ->postJson('/api/v1/tasks/items', [
                'taskListIds' => [$sharedId => true],
                'title' => 'Alice task',
            ])
            ->assertCreated()
            ->json('id');

        $taskUrl = '/api/v1/tasks/items/'.$taskId;
        $this->asUser('alice')
            ->patchJson($taskUrl, ['title' => 'Alice task edited'], $this->withIfMatch($this->fetchEtagFromGetAs('alice', $taskUrl)))
            ->assertOk()
            ->assertJsonPath('title', 'Alice task edited');

        $this->asUser('alice')
            ->deleteJson($taskUrl, [], $this->withIfMatch($this->fetchEtagFromGetAs('alice', $taskUrl)))
            ->assertOk()
            ->assertJsonPath('ok', true);
    }

    public function test_owner_can_change_permission_and_revoke(): void
    {
        $listId = $this->createPersonalList('bob', 'Revoke Share');
        $this->shareList('bob', $listId, 'alice', write: false);

        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, [
                'shareWith' => ['alice' => ['mayWriteAll' => true]],
            ])
            ->assertOk();
        $this->assertTrue($this->listNamed('alice', 'Revoke Share')['myRights']['mayWriteAll']);

        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, [
                'shareWith' => ['alice' => null],
            ])
            ->assertOk()
            ->assertJsonPath('shareWith', null);

        $aliceNames = collect($this->asUser('alice')->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list'))
            ->pluck('name')
            ->all();
        $this->assertNotContains('Revoke Share', $aliceNames);
    }

    public function test_sharee_can_set_own_name_and_color(): void
    {
        $listId = $this->createPersonalList('bob', 'Color Share', '#6366f1');
        $this->shareList('bob', $listId, 'alice', write: false);
        $sharedId = (string) $this->listNamed('alice', 'Color Share')['id'];

        $this->asUser('alice')
            ->patchJson('/api/v1/tasks/tasklists/'.$sharedId, [
                'name' => 'Family (mine)',
                'color' => '#ef4444',
            ])
            ->assertOk()
            ->assertJsonPath('name', 'Family (mine)')
            ->assertJsonPath('color', '#ef4444');

        $owner = $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$listId)->assertOk()->json();
        $this->assertSame('Color Share', $owner['name']);
        $this->assertSame('#6366f1', $owner['color']);
    }

    public function test_sharee_cannot_change_share_with_or_description(): void
    {
        $listId = $this->createPersonalList('bob', 'Locked Fields');
        $this->shareList('bob', $listId, 'alice', write: true);
        $sharedId = (string) $this->listNamed('alice', 'Locked Fields')['id'];

        $this->asUser('alice')
            ->patchJson('/api/v1/tasks/tasklists/'.$sharedId, [
                'shareWith' => ['carol' => ['mayReadItems' => true]],
            ])
            ->assertForbidden();

        $this->asUser('alice')
            ->patchJson('/api/v1/tasks/tasklists/'.$sharedId, [
                'description' => 'Hijacked',
            ])
            ->assertForbidden();
    }

    public function test_sharee_delete_dismisses_without_destroying_owner_list(): void
    {
        $listId = $this->createPersonalList('bob', 'Leave Me');
        $this->shareList('bob', $listId, 'alice', write: false);
        $shared = $this->listNamed('alice', 'Leave Me');
        $sharedId = (string) $shared['id'];
        $this->assertTrue($shared['myRights']['mayDelete']);

        $this->asUser('alice')
            ->deleteJson('/api/v1/tasks/tasklists/'.$sharedId)
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->assertTrue(
            CalendarShareDismissal::query()->where('username', 'alice')->exists(),
            'Expected a share dismissal for alice',
        );

        $aliceNames = collect($this->asUser('alice')->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list'))
            ->pluck('name')
            ->all();
        $this->assertNotContains('Leave Me', $aliceNames);

        $owner = $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$listId)->assertOk()->json();
        $this->assertSame('Leave Me', $owner['name']);
        $this->assertIsArray($owner['shareWith']['alice'] ?? null);
    }

    public function test_owner_can_share_personal_list_with_a_group(): void
    {
        $listId = $this->createPersonalList('bob', 'Group Share');

        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, [
                'shareWith' => ['groups/'.self::TEAM => ['mayWriteAll' => true]],
            ])
            ->assertOk();
        $grant = $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$listId)->assertOk()->json('shareWith.groups/'.self::TEAM);
        $this->assertIsArray($grant);
        $this->assertTrue($grant['mayWrite'] ?? $grant['mayWriteAll'] ?? false);

        $bobMatches = collect($this->asUser('bob')->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list'))
            ->where('name', 'Group Share');
        $this->assertCount(1, $bobMatches);
        $this->assertFalse((bool) $bobMatches->first()['isSharee']);

        $alice = Principal::forUsername('alice');
        $team = Principal::query()->where('uri', 'principals/groups/'.self::TEAM)->first();
        $this->assertNotNull($alice);
        $this->assertNotNull($team);
        $this->addPrincipalToGroup($team, $alice);

        $shared = $this->listNamed('alice', 'Group Share');
        $this->assertNotSame($listId, $shared['id']);
        $this->assertTrue($shared['isSharee']);
        $this->assertTrue($shared['myRights']['mayWriteAll']);
        $this->assertNull($shared['shareWith']);
    }

    public function test_read_group_share_cannot_write_tasks(): void
    {
        $listId = $this->createPersonalList('bob', 'Read Group Share');
        $this->shareList('bob', $listId, 'groups/'.self::TEAM, write: false);

        $alice = Principal::forUsername('alice');
        $team = Principal::query()->where('uri', 'principals/groups/'.self::TEAM)->first();
        $this->assertNotNull($alice);
        $this->assertNotNull($team);
        $this->addPrincipalToGroup($team, $alice);

        $sharedId = (string) $this->listNamed('alice', 'Read Group Share')['id'];
        $this->assertFalse($this->listNamed('alice', 'Read Group Share')['myRights']['mayWriteAll']);

        $this->asUser('alice')
            ->postJson('/api/v1/tasks/items', [
                'taskListIds' => [$sharedId => true],
                'title' => 'Group write should fail',
            ])
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }

    public function test_group_member_not_manager_still_sees_group_list_as_owned_scope(): void
    {
        $listId = CalendarCollectionUris::groupTaskListApiId(self::TEAM);
        $groupList = $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$listId)->assertOk()->json();
        $this->assertSame('group', $groupList['scope']);
        $this->assertSame('group', $groupList['role']);
        $this->assertSame(self::TEAM, $groupList['groupSlug']);
        $this->assertFalse($groupList['isSharee']);
        $this->assertTrue($groupList['myRights']['mayWriteAll']);

        $ids = collect($this->asUser('bob')->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list'))
            ->pluck('id')
            ->all();
        $this->assertContains($listId, $ids);
    }

    public function test_inbox_still_cannot_be_deleted_after_share(): void
    {
        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.InboxTaskListProvisioner::URI, [
                'shareWith' => ['alice' => ['mayReadItems' => true]],
            ])
            ->assertOk();

        $this->asUser('bob')
            ->deleteJson('/api/v1/tasks/tasklists/'.InboxTaskListProvisioner::URI)
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }

    private function asUser(string $username)
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token);
    }

    private function fetchEtagFromGetAs(string $username, string $url): string
    {
        $etag = $this->asUser($username)->getJson($url)->assertOk()->headers->get('ETag');
        $this->assertIsString($etag);
        $this->assertNotSame('', $etag);

        return $etag;
    }

    private function createPersonalList(string $username, string $name, ?string $color = null): string
    {
        $payload = ['name' => $name];
        if ($color !== null) {
            $payload['color'] = $color;
        }

        return (string) $this->asUser($username)
            ->postJson('/api/v1/tasks/tasklists', $payload)
            ->assertCreated()
            ->json('id');
    }

    private function shareList(string $owner, string $listId, string $sharee, bool $write): void
    {
        $rights = $write
            ? ['mayWriteAll' => true]
            : ['mayReadItems' => true];

        $this->asUser($owner)
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, [
                'shareWith' => [$sharee => $rights],
            ])
            ->assertOk();
    }

    /**
     * @return array<string, mixed>
     */
    private function listNamed(string $username, string $name): array
    {
        $list = $this->asUser($username)->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list');
        $row = collect($list)->first(static fn (array $item): bool => ($item['name'] ?? '') === $name);
        $this->assertIsArray($row, "Expected {$username} to see task list {$name}");

        return $row;
    }
}
