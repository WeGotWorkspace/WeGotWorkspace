<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Services\Notify\TaskStatusChangedNotify;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Task workflowStatus change → list ACL owners suite inbox (Task #798).
 */
final class TaskStatusChangedNotifyTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedInboxTaskListFor('alice');
    }

    public function test_sharee_status_change_notifies_owner_not_actor(): void
    {
        $listId = $this->createPersonalList('bob', 'Status Projects');
        $this->shareListWrite('bob', $listId, 'alice');
        $sharedId = (string) $this->listNamed('alice', 'Status Projects')['id'];

        $taskId = (string) $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            'taskListIds' => [$listId => true],
            'title' => 'Pay rent',
        ])->assertCreated()->json('id');

        Notification::query()->delete();

        $url = '/api/v1/tasks/items/'.$taskId;
        $this->asUser('alice')->patchJson($url, [
            'workflowStatus' => 'completed',
            'progress' => 100,
        ], $this->withIfMatch($this->fetchEtagFromGetAs('alice', $url)))->assertOk();

        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'status_changed')->count());
        $this->assertSame(0, Notification::query()->where('principal', 'alice')->where('action', 'status_changed')->count());

        $row = Notification::query()->where('principal', 'bob')->where('action', 'status_changed')->first();
        $this->assertNotNull($row);
        $this->assertSame(TaskStatusChangedNotify::NAVIGATE, $row->navigate);
        $this->assertSame('Alice completed Pay rent', $row->title);
        $this->assertSame('completed', $row->body);
        $this->assertIsArray($row->data);
        $this->assertSame('Alice', $row->data['actor'] ?? null);
        $this->assertSame('completed', $row->data['toStatus'] ?? null);
        $this->assertSame($taskId, $row->data['taskId'] ?? null);
        $this->assertStringStartsWith('tasks.status_changed:', (string) $row->tag);
        $this->assertNotSame('', (string) ($row->data['taskListId'] ?? ''));
        $this->assertNotSame($sharedId, '');
    }

    public function test_owner_self_status_change_does_not_self_notify(): void
    {
        $taskId = (string) $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload(),
            'title' => 'Self status',
        ])->assertCreated()->json('id');

        Notification::query()->delete();

        $url = '/api/v1/tasks/items/'.$taskId;
        $this->asUser('bob')->patchJson($url, [
            'workflowStatus' => 'in-process',
            'progress' => 25,
        ], $this->withIfMatch($this->fetchEtagFromGetAs('bob', $url)))->assertOk();

        $this->assertSame(0, Notification::query()->where('action', 'status_changed')->count());
    }

    public function test_rapid_status_flips_supersede_same_task_row(): void
    {
        $listId = $this->createPersonalList('bob', 'Flip List');
        $this->shareListWrite('bob', $listId, 'alice');

        $taskId = (string) $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            'taskListIds' => [$listId => true],
            'title' => 'Flip me',
        ])->assertCreated()->json('id');

        Notification::query()->delete();
        $url = '/api/v1/tasks/items/'.$taskId;

        $this->asUser('alice')->patchJson($url, [
            'workflowStatus' => 'in-process',
            'progress' => 50,
        ], $this->withIfMatch($this->fetchEtagFromGetAs('alice', $url)))->assertOk();

        $before = Notification::query()->where('principal', 'bob')->where('action', 'status_changed')->first();
        $this->assertNotNull($before);
        $beforeId = $before->id;

        $this->asUser('alice')->patchJson($url, [
            'workflowStatus' => 'completed',
            'progress' => 100,
        ], $this->withIfMatch($this->fetchEtagFromGetAs('alice', $url)))->assertOk();

        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'status_changed')->count());
        $after = Notification::query()->where('principal', 'bob')->where('action', 'status_changed')->first();
        $this->assertNotNull($after);
        $this->assertSame($beforeId, $after->id);
        $this->assertSame('Alice completed Flip me', $after->title);
        $this->assertSame('completed', $after->data['toStatus'] ?? null);
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
        $this->assertNotNull($etag);
        $this->assertNotSame('', (string) $etag);

        return (string) $etag;
    }

    private function createPersonalList(string $username, string $name): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/tasks/tasklists', ['name' => $name])
            ->assertCreated()
            ->json('id');
    }

    private function shareListWrite(string $owner, string $listId, string $sharee): void
    {
        $this->asUser($owner)
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, [
                'shareWith' => [$sharee => ['mayWriteAll' => true]],
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
