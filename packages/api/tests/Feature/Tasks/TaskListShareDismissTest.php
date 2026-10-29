<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\Principal;
use Illuminate\Testing\TestResponse;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Dismissing an inbound task-list share ends access by every id until the
 * sharee restores it with `isSubscribed: true`. The owner's grant stays.
 */
final class TaskListShareDismissTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedInboxTaskListFor('alice');
    }

    public function test_dismissed_task_list_no_longer_resolves_by_id(): void
    {
        [$listId, $sharedId, $taskId] = $this->sharedListWithTask('Dismiss Me');

        $this->asUser('alice')->deleteJson('/api/v1/tasks/tasklists/'.$sharedId)->assertOk();

        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/tasks/tasklists/'.$sharedId));
        $this->assertNotFound($this->asUser('alice')->patchJson('/api/v1/tasks/tasklists/'.$sharedId, ['name' => 'Renamed']));
        $this->assertNotFound($this->asUser('alice')->deleteJson('/api/v1/tasks/tasklists/'.$sharedId));
        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/tasks/items?taskListId='.$sharedId));
        $this->assertNotFound($this->asUser('alice')->postJson('/api/v1/tasks/items/query', ['filter' => ['inTaskList' => $sharedId]]));
        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/tasks/items/'.$taskId));
        $this->assertNotFound($this->asUser('alice')->patchJson('/api/v1/tasks/items/'.$taskId, ['title' => 'Edited'], $this->withIfMatch('"any"')));
        $this->assertNotFound($this->asUser('alice')->deleteJson('/api/v1/tasks/items/'.$taskId, [], $this->withIfMatch('"any"')));
        $this->assertNotFound($this->asUser('alice')->postJson('/api/v1/tasks/items', [
            'taskListIds' => [$sharedId => true],
            'title' => 'Into a dismissed list',
        ]));

        $this->assertNotContains('Dismiss Me', $this->listNames('alice'));
        $owner = $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$listId)->assertOk();
        $this->assertIsArray($owner->json('shareWith.alice'));
        $this->asUser('bob')->getJson('/api/v1/tasks/items/'.$taskId)->assertOk()->assertJsonPath('title', 'Owner task');
    }

    public function test_restoring_a_dismissed_task_list_brings_access_back(): void
    {
        [, $sharedId, $taskId] = $this->sharedListWithTask('Come Back');
        $this->asUser('alice')->deleteJson('/api/v1/tasks/tasklists/'.$sharedId)->assertOk();

        $this->asUser('alice')
            ->patchJson('/api/v1/tasks/tasklists/'.$sharedId, ['isSubscribed' => true])
            ->assertOk()
            ->assertJsonPath('id', $sharedId)
            ->assertJsonPath('isSharee', true);

        $this->assertContains('Come Back', $this->listNames('alice'));
        $this->asUser('alice')->getJson('/api/v1/tasks/tasklists/'.$sharedId)->assertOk();
        $this->asUser('alice')->getJson('/api/v1/tasks/items/'.$taskId)->assertOk()->assertJsonPath('title', 'Owner task');
        $this->asUser('alice')
            ->postJson('/api/v1/tasks/items', ['taskListIds' => [$sharedId => true], 'title' => 'After restore'])
            ->assertCreated();
    }

    public function test_restore_and_rename_in_one_patch(): void
    {
        [, $sharedId] = $this->sharedListWithTask('Old Name');
        $this->asUser('alice')->deleteJson('/api/v1/tasks/tasklists/'.$sharedId)->assertOk();

        $this->asUser('alice')
            ->patchJson('/api/v1/tasks/tasklists/'.$sharedId, ['isSubscribed' => true, 'name' => 'My Copy'])
            ->assertOk()
            ->assertJsonPath('name', 'My Copy');

        $this->assertContains('My Copy', $this->listNames('alice'));
    }

    public function test_is_subscribed_false_dismisses_like_delete(): void
    {
        [$listId, $sharedId, $taskId] = $this->sharedListWithTask('Unsubscribe');

        $this->asUser('alice')
            ->patchJson('/api/v1/tasks/tasklists/'.$sharedId, ['isSubscribed' => false])
            ->assertOk();

        $this->assertNotContains('Unsubscribe', $this->listNames('alice'));
        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/tasks/items/'.$taskId));
        $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$listId)->assertOk();
    }

    public function test_a_revoked_share_cannot_be_restored(): void
    {
        [$listId, $sharedId] = $this->sharedListWithTask('Revoked');
        $this->asUser('alice')->deleteJson('/api/v1/tasks/tasklists/'.$sharedId)->assertOk();
        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, ['shareWith' => ['alice' => null]])
            ->assertOk();

        $this->assertNotFound($this->asUser('alice')->patchJson('/api/v1/tasks/tasklists/'.$sharedId, ['isSubscribed' => true]));
        $this->assertNotContains('Revoked', $this->listNames('alice'));
    }

    public function test_is_subscribed_does_not_change_an_owned_list(): void
    {
        $listId = $this->createPersonalList('bob', 'Mine');

        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$listId, ['isSubscribed' => false])->assertOk();

        $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$listId)->assertOk();
        $this->assertContains('Mine', $this->listNames('bob'));
    }

    public function test_dismissing_a_list_shared_with_a_group_ends_access_for_that_member_only(): void
    {
        $team = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Team');
        foreach (['alice', 'carol'] as $username) {
            $principal = Principal::forUsername($username);
            $this->assertNotNull($principal);
            $this->addPrincipalToGroup($team, $principal);
        }
        $listId = $this->createPersonalList('bob', 'Team Share');
        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, ['shareWith' => ['groups/'.self::TEAM => ['mayReadItems' => true]]])
            ->assertOk();
        $sharedId = (string) $this->listNamed('alice', 'Team Share')['id'];

        $this->asUser('alice')->deleteJson('/api/v1/tasks/tasklists/'.$sharedId)->assertOk();

        $this->assertNotFound($this->asUser('alice')->getJson('/api/v1/tasks/tasklists/'.$sharedId));
        $this->asUser('carol')->getJson('/api/v1/tasks/tasklists/'.$sharedId)->assertOk();

        $this->asUser('alice')->patchJson('/api/v1/tasks/tasklists/'.$sharedId, ['isSubscribed' => true])->assertOk();
        $this->asUser('alice')->getJson('/api/v1/tasks/tasklists/'.$sharedId)->assertOk();
    }

    /**
     * @return array{0: string, 1: string, 2: string} owner list id, sharee list id, owner task id
     */
    private function sharedListWithTask(string $name): array
    {
        $listId = $this->createPersonalList('bob', $name);
        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, ['shareWith' => ['alice' => ['mayWriteAll' => true]]])
            ->assertOk();
        $taskId = (string) $this->asUser('bob')
            ->postJson('/api/v1/tasks/items', ['taskListIds' => [$listId => true], 'title' => 'Owner task'])
            ->assertCreated()
            ->json('id');

        return [$listId, (string) $this->listNamed('alice', $name)['id'], $taskId];
    }

    private function assertNotFound(TestResponse $response): void
    {
        $response->assertNotFound()->assertJsonPath('code', 'not_found');
    }

    private function asUser(string $username): static
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token);
    }

    private function createPersonalList(string $username, string $name): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/tasks/tasklists', ['name' => $name])
            ->assertCreated()
            ->json('id');
    }

    /**
     * @return list<string>
     */
    private function listNames(string $username): array
    {
        return collect($this->asUser($username)->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list'))
            ->pluck('name')
            ->all();
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
