<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarObject;
use App\Services\Tasks\InboxTaskListProvisioner;
use App\Services\Tasks\TaskRepository;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The app picks a task's UID before it sends the create, and sends the same
 * UID on every resend (#2155). Safari reports a create that a reload cut off
 * as failed although the server stored it; the outbox then sends it again. A
 * resend must land on the first task instead of making a second one.
 */
final class TasksClientUidCreateTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    public function test_resending_the_same_create_returns_the_first_task(): void
    {
        $uid = 'urn:uuid:'.Str::uuid();
        $first = $this->create($uid, 'Buy milk')->assertCreated();
        $id = (string) $first->json('id');

        foreach (['Buy milk', 'Second tab'] as $title) {
            $this->create($uid, $title)
                ->assertOk()
                ->assertJsonPath('id', $id)
                ->assertJsonPath('uid', $uid)
                ->assertJsonPath('title', 'Buy milk');
        }

        $this->assertSame(1, CalendarObject::query()->where('uid', $uid)->count());
        $listed = collect($this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)
            ->assertOk()
            ->json('list'))
            ->where('uid', $uid);
        $this->assertCount(1, $listed);
    }

    public function test_the_same_uid_in_another_list_is_a_task_of_its_own(): void
    {
        $uid = 'urn:uuid:'.Str::uuid();
        $this->create($uid, 'In the inbox')->assertCreated();
        $other = (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Side project'])
            ->assertCreated()
            ->json('id');

        $this->create($uid, 'Elsewhere', $other)
            ->assertCreated()
            ->assertJsonPath('taskListId', $other)
            ->assertJsonPath('title', 'Elsewhere');
    }

    public function test_without_a_uid_every_create_is_a_new_task(): void
    {
        $payload = $this->sampleTaskCreatePayload();
        $token = $this->userBearerToken();
        $a = (string) $this->withBearer($token)->postJson('/api/v1/tasks/items', $payload)->assertCreated()->json('id');
        $b = (string) $this->withBearer($token)->postJson('/api/v1/tasks/items', $payload)->assertCreated()->json('id');

        $this->assertNotSame($a, $b);
    }

    public function test_a_resend_that_loses_the_race_gets_the_task_the_winner_made(): void
    {
        // Two sends of one create: the other one stores the task after this
        // request found none and before it inserts its own.
        $uid = 'urn:uuid:'.Str::uuid();
        $raced = false;
        DB::connection('wgw')->listen(function (QueryExecuted $query) use (&$raced, $uid): void {
            if ($raced || ! str_contains($query->sql, 'calendarobjects') || ! in_array($uid, $query->bindings, true)) {
                return;
            }
            $raced = true;
            app(TaskRepository::class)->create('bob', [
                ...$this->sampleTaskCreatePayload(),
                'uid' => $uid,
                'title' => 'Winner',
            ]);
        });

        $this->create($uid, 'Loser')
            ->assertOk()
            ->assertJsonPath('uid', $uid)
            ->assertJsonPath('title', 'Winner');

        $this->assertTrue($raced, 'The race was never set up.');
        $this->assertSame(1, CalendarObject::query()->where('uid', $uid)->count());
    }

    private function create(string $uid, string $title, string $listId = InboxTaskListProvisioner::URI): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload($listId),
            'uid' => $uid,
            'title' => $title,
        ]);
    }
}
