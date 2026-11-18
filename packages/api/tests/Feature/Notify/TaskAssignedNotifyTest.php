<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\GroupMember;
use App\Models\Notification;
use App\Models\Principal;
use App\Services\Notify\NotifiedRecipients;
use App\Services\Notify\TaskAssignedNotify;
use App\Services\Notify\TaskAssignedRateLimiter;
use App\Services\Tasks\TaskChangeSet;
use App\Services\Tasks\TaskListRepository;
use Illuminate\Testing\TestResponse;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * `tasks.assigned` for REST writes (#2172).
 *
 * bob owns "Groceries", shared with alice (write) and carol (read). All three
 * share Team "crew".
 */
final class TaskAssignedNotifyTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    private string $listId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedInboxTaskListFor('alice');
        $this->seedSharedTeam('crew', 'bob', 'alice', 'carol');

        $this->listId = (string) $this->asUser('bob')
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Groceries'])
            ->assertCreated()
            ->json('id');
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['shareWith' => [
            'alice' => ['mayWriteAll' => true],
            'carol' => ['mayWriteAll' => false],
        ]])->assertOk();
    }

    public function test_assigning_notifies_the_new_assignee_once(): void
    {
        $taskId = $this->createTask();

        $this->assign($taskId, ['u:alice' => $this->attendee()])
            ->assertOk()
            ->assertHeader(NotifiedRecipients::HEADER, 'alice');

        $rows = Notification::query()->where('action', TaskAssignedNotify::ACTION)->get();
        $this->assertCount(1, $rows);
        $row = $rows->first();
        $this->assertNotNull($row);
        $this->assertSame('alice', $row->principal);
        $this->assertSame('Bob assigned you Buy milk', $row->title);
        $this->assertSame('/tasks/state/all?task='.rawurlencode($taskId), $row->navigate);
        $this->assertSame($taskId, $row->data['taskId'] ?? null);

        // A later edit that keeps alice assigned does not ring again.
        $this->patchAs('bob', $taskId, ['title' => 'Buy oat milk'])->assertOk();
        $this->assertSame(1, Notification::query()->where('action', TaskAssignedNotify::ACTION)->count());
    }

    public function test_create_with_an_assignee_notifies_them(): void
    {
        $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload($this->listId),
            'title' => 'Pay rent',
            'participants' => ['u:alice' => $this->attendee()],
        ])->assertCreated();

        $row = Notification::query()->where('action', TaskAssignedNotify::ACTION)->first();
        $this->assertNotNull($row);
        $this->assertSame('alice', $row->principal);
        $this->assertSame('Bob assigned you Pay rent', $row->title);
    }

    public function test_self_assign_and_external_address_notify_nobody(): void
    {
        $taskId = $this->createTask();

        $this->assign($taskId, [
            'u:bob' => $this->attendee(),
            'x' => ['@type' => 'Participant', 'email' => 'guest@outside.test', 'roles' => ['attendee']],
        ])->assertOk();

        $this->assertSame(0, Notification::query()->where('action', TaskAssignedNotify::ACTION)->count());
    }

    public function test_unassigning_notifies_nobody_and_reassigning_replaces_the_notice(): void
    {
        $taskId = $this->createTask();
        $this->assign($taskId, ['u:alice' => $this->attendee()])->assertOk();
        $first = Notification::query()->where('action', TaskAssignedNotify::ACTION)->firstOrFail();
        $first->forceFill(['read_at' => now()])->save();

        $this->assign($taskId, ['u:alice' => null])->assertOk();
        $this->assertSame(1, Notification::query()->where('action', TaskAssignedNotify::ACTION)->count());

        $this->assign($taskId, ['u:alice' => $this->attendee()])->assertOk();
        $rows = Notification::query()->where('action', TaskAssignedNotify::ACTION)->get();
        $this->assertCount(1, $rows);
        $this->assertNull($rows->first()?->read_at);
    }

    public function test_a_sharee_assigning_the_owner_notifies_the_owner_not_the_actor(): void
    {
        $taskId = $this->createTask();

        $this->patchAs('alice', $taskId, ['participants' => [
            'u:bob' => $this->attendee(),
            'u:alice' => $this->attendee(),
        ]])->assertOk();

        $this->assertSame(
            ['bob'],
            Notification::query()->where('action', TaskAssignedNotify::ACTION)->pluck('principal')->all(),
        );
    }

    public function test_status_change_recipients_stay_the_same(): void
    {
        $taskId = $this->createTask();
        $this->assign($taskId, ['u:alice' => $this->attendee()])->assertOk();
        Notification::query()->delete();

        $this->patchAs('alice', $taskId, ['workflowStatus' => 'completed', 'progress' => 100])->assertOk();

        // #798: the owner hears of it, the actor does not, and nobody is "assigned" again.
        $this->assertSame(['bob'], Notification::query()->where('action', 'status_changed')->pluck('principal')->all());
        $this->assertSame(0, Notification::query()->where('action', TaskAssignedNotify::ACTION)->count());
    }

    public function test_notices_from_one_actor_to_one_recipient_are_capped(): void
    {
        // Each new task with alice is a new notice; the pair budget stops the flood.
        for ($i = 0; $i < TaskAssignedRateLimiter::PAIR_LIMIT + 3; $i++) {
            $this->asUser('bob')->postJson('/api/v1/tasks/items', [
                ...$this->sampleTaskCreatePayload($this->listId),
                'title' => 'Chore '.$i,
                'participants' => ['u:alice' => $this->attendee()],
            ])->assertCreated();
        }

        $this->assertSame(
            TaskAssignedRateLimiter::PAIR_LIMIT,
            Notification::query()->where('action', TaskAssignedNotify::ACTION)->where('principal', 'alice')->count(),
        );
    }

    public function test_reassigning_over_and_over_stops_marking_the_notice_unread(): void
    {
        $taskId = $this->createTask();
        for ($i = 0; $i < TaskAssignedRateLimiter::PAIR_LIMIT; $i++) {
            $this->assign($taskId, ['u:alice' => $this->attendee()])->assertOk();
            $this->assign($taskId, ['u:alice' => null])->assertOk();
        }
        Notification::query()->where('action', TaskAssignedNotify::ACTION)->update(['read_at' => now()]);

        $this->assign($taskId, ['u:alice' => $this->attendee()])
            ->assertOk()
            ->assertJsonPath('participants.u:alice.username', 'alice');

        $this->assertNotNull(Notification::query()->where('action', TaskAssignedNotify::ACTION)->firstOrFail()->read_at);
    }

    public function test_someone_removed_from_the_team_is_not_notified(): void
    {
        // dave could edit the list through Team "side" until he left it.
        $this->seedWgwUser('dave', displayName: 'Dave', email: 'dave@example.test');
        $this->seedSharedTeam('side', 'bob', 'dave');
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['shareWith' => [
            'alice' => ['mayWriteAll' => true],
            'carol' => ['mayWriteAll' => false],
            'groups/side' => ['mayWriteAll' => true],
        ]])->assertOk();
        $team = Principal::query()->where('uri', 'principals/groups/side')->firstOrFail();
        $dave = Principal::forUsername('dave');
        $this->assertNotNull($dave);
        GroupMember::query()->where('principal_id', $team->id)->where('member_id', $dave->id)->delete();

        $list = app(TaskListRepository::class)->findAccessibleTaskList('bob', $this->listId);
        $this->assertNotNull($list);
        $before = ['id' => 'task-1', 'title' => 'Buy milk'];
        $after = [...$before, 'participants' => ['u:dave' => ['@type' => 'Participant', 'roles' => ['attendee'], 'username' => 'dave']]];

        app(TaskAssignedNotify::class)->notify('bob', $list, $after, TaskChangeSet::between($before, $after));

        $this->assertSame(0, Notification::query()->where('action', TaskAssignedNotify::ACTION)->count());
    }

    public function test_a_hidden_members_address_notifies_nobody(): void
    {
        // erin edits the list and shares a Team with bob only: to her, alice's address is a guest.
        $this->seedWgwUser('erin', displayName: 'Erin', email: 'erin@example.test');
        $this->seedSharedTeam('side', 'bob', 'erin');
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['shareWith' => [
            'alice' => ['mayWriteAll' => true],
            'carol' => ['mayWriteAll' => false],
            'erin' => ['mayWriteAll' => true],
        ]])->assertOk();
        $taskId = $this->createTask();

        $this->patchAs('erin', $taskId, ['participants' => [
            'e:alice@example.test' => ['@type' => 'Participant', 'email' => 'alice@example.test', 'roles' => ['attendee']],
        ]])->assertOk();

        $this->assertSame(0, Notification::query()->where('action', TaskAssignedNotify::ACTION)->count());
    }

    /**
     * @return array<string, mixed>
     */
    private function attendee(): array
    {
        return ['@type' => 'Participant', 'roles' => ['attendee']];
    }

    private function createTask(): string
    {
        return (string) $this->asUser('bob')
            ->postJson('/api/v1/tasks/items', [...$this->sampleTaskCreatePayload($this->listId), 'title' => 'Buy milk'])
            ->assertCreated()
            ->json('id');
    }

    /**
     * @param  array<string, mixed>  $participants
     */
    private function assign(string $taskId, array $participants): TestResponse
    {
        return $this->patchAs('bob', $taskId, ['participants' => $participants]);
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function patchAs(string $username, string $taskId, array $patch): TestResponse
    {
        $url = '/api/v1/tasks/items/'.$taskId;
        $etag = (string) $this->asUser($username)->getJson($url)->assertOk()->json('etag');

        return $this->asUser($username)->patchJson($url, $patch, $this->withIfMatch($etag));
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($username === 'bob' ? $this->userBearerToken() : $this->issueBearerTokenFor($username));
    }
}
