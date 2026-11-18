<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\ThreadIndex;
use App\Services\Threads\ThreadLifecycle;
use App\Services\Threads\ThreadRepository;
use Tests\Support\TasksTestFixtures as BaseTaskFixtures;
use Tests\Support\Threads\TaskThreadFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * What task writes do to task threads (#2173, spec.md "Lifecycle hooks"):
 * the history belongs to the list; nothing but the owner's list delete
 * removes entries.
 */
final class TaskThreadLifecycleTest extends WgwDatabaseTestCase
{
    use TaskThreadFixtures;

    private string $listId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTaskThreads();
        $this->listId = $this->groceries();
    }

    public function test_thread_hook_failure_keeps_the_task_write(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $private = $this->createList('bob', 'Private');
        $this->app->bind(ThreadRepository::class, static fn () => throw new \RuntimeException('thread store down'));

        $this->moveTask('bob', $taskId, $private)->assertOk();

        $this->asUser('bob')->getJson('/api/v1/tasks/items/'.$taskId)
            ->assertOk()
            ->assertJsonPath('taskListId', $private);
    }

    public function test_caldav_move_writes_moved_here_and_keeps_source_entries(): void
    {
        $groceries = $this->listUriOf('bob', 'Groceries');
        $this->createList('bob', 'Private');
        $private = $this->listUriOf('bob', 'Private');
        $ics = $this->vtodo('milk-1', 'Milk');
        $this->dav('bob', 'PUT', $groceries.'/milk.ics', $ics)->assertCreated();
        $taskId = BaseTaskFixtures::taskIdFromObjectUri('milk.ics', $ics);
        $this->comment('alice', $taskId, 'Stays in Groceries')->assertCreated();

        $this->dav('bob', 'MOVE', $groceries.'/milk.ics', '', ['HTTP_DESTINATION' => '/calendars/bob/'.$private.'/milk.ics'])
            ->assertCreated();

        $entries = $this->entries('bob', $taskId);
        $this->assertSame([['field' => 'moved']], array_column($entries, 'activity'));
        $this->assertSame(1, ThreadIndex::query()->where('kind', 'comment')->count());
        $this->asUser('alice')->getJson($this->threadUrl($taskId, 'entries'))->assertNotFound();
    }

    public function test_delete_then_put_elsewhere_starts_fresh_and_keeps_source_entries(): void
    {
        $groceries = $this->listUriOf('bob', 'Groceries');
        $this->createList('bob', 'Private');
        $private = $this->listUriOf('bob', 'Private');
        $ics = $this->vtodo('milk-1', 'Milk');
        $this->dav('bob', 'PUT', $groceries.'/milk.ics', $ics)->assertCreated();
        $taskId = BaseTaskFixtures::taskIdFromObjectUri('milk.ics', $ics);
        $this->comment('alice', $taskId, 'Stays in Groceries')->assertCreated();

        $this->dav('bob', 'DELETE', $groceries.'/milk.ics')->assertNoContent();
        $this->dav('bob', 'PUT', $private.'/milk.ics', $ics)->assertCreated();

        $this->assertSame([], array_filter($this->entries('bob', $taskId), static fn (array $entry): bool => $entry['kind'] !== 'activity'));
        $this->assertSame(1, ThreadIndex::query()->where('kind', 'comment')->count());
    }

    public function test_writing_the_uid_back_shows_the_old_entries_again(): void
    {
        $groceries = $this->listUriOf('bob', 'Groceries');
        $ics = $this->vtodo('milk-1', 'Milk');
        $this->dav('bob', 'PUT', $groceries.'/milk.ics', $ics)->assertCreated();
        $taskId = BaseTaskFixtures::taskIdFromObjectUri('milk.ics', $ics);
        $this->comment('alice', $taskId, 'Still here')->assertCreated();

        $this->dav('bob', 'DELETE', $groceries.'/milk.ics')->assertNoContent();
        $this->asUser('bob')->getJson($this->threadUrl($taskId, 'entries'))->assertNotFound();
        $this->dav('bob', 'PUT', $groceries.'/milk.ics', $ics)->assertCreated();

        $this->assertSame(['Still here'], array_column($this->entries('alice', $taskId), 'body'));
    }

    public function test_deleted_task_entries_stay_until_the_owner_deletes_the_list(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $this->comment('alice', $taskId, 'Hidden after the delete')->assertCreated();
        $etag = $this->asUser('bob')->getJson('/api/v1/tasks/items/'.$taskId)->headers->get('ETag');
        $this->asUser('bob')->withHeader('If-Match', (string) $etag)->deleteJson('/api/v1/tasks/items/'.$taskId)->assertOk();

        $this->assertSame(1, $this->entryCount());

        $this->asUser('bob')->deleteJson('/api/v1/tasks/tasklists/'.$this->listId)->assertOk();
        $this->assertSame(0, $this->entryCount());
    }

    public function test_giving_the_list_to_a_team_keeps_its_threads(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $id = $this->ulid();
        $this->comment('bob', $taskId, 'Before the Team', ['id' => $id])->assertCreated();

        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['groupSlug' => 'crew'])->assertOk();

        $this->assertSame(['Before the Team'], array_column($this->entries('bob', $taskId), 'body'));
        $this->assertSame(['Before the Team'], array_column($this->entries('carol', $taskId), 'body'));
        $this->comment('bob', $taskId, 'Before the Team', ['id' => $id])->assertOk()->assertJsonPath('id', $id);
        $this->comment('alice', $taskId, 'After the Team')->assertCreated();
        $this->assertSame(['Before the Team', 'After the Team'], array_column($this->entries('bob', $taskId), 'body'));
        $this->assertSame(1, ThreadIndex::query()->distinct()->count('pool_calendarid'));
    }

    public function test_stale_changes_state_after_a_transfer_is_never_an_empty_answer(): void
    {
        $other = $this->createList('bob', 'Other');
        $otherTask = $this->createTask('bob', $other, 'Eggs');
        for ($i = 0; $i < 6; $i++) {
            $this->comment('bob', $otherTask, 'Noise '.$i)->assertCreated();
        }
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $this->comment('bob', $taskId, 'Before the Team')->assertCreated();
        $state = (string) $this->asUser('bob')->getJson($this->threadUrl($taskId, 'entries'))->assertOk()->json('state');

        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['groupSlug' => 'crew'])->assertOk();
        $new = $this->comment('alice', $taskId, 'After the Team')->assertCreated()->json('id');

        $response = $this->asUser('bob')->getJson($this->threadUrl($taskId, 'changes').'?since='.$state);
        if ($response->status() === 200) {
            $this->assertContains($new, $response->json('changed'));
        } else {
            $response->assertStatus(400)->assertJsonPath('code', 'cannotCalculateChanges');
        }
    }

    public function test_failed_rehome_rolls_the_owner_change_back(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $this->comment('bob', $taskId, 'Kept')->assertCreated();
        $this->app->bind(ThreadLifecycle::class, static fn () => new class
        {
            public function scopeOwnerChanged(): void
            {
                throw new \RuntimeException('pool down');
            }
        });

        $this->withoutExceptionHandling();
        try {
            $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['groupSlug' => 'crew']);
            $this->fail('The owner change should fail.');
        } catch (\RuntimeException $e) {
            $this->assertSame('pool down', $e->getMessage());
        }

        $this->assertSame(['Kept'], array_column($this->entries('bob', $taskId), 'body'));
        $this->assertSame(1, ThreadIndex::query()->distinct()->count('pool_calendarid'));
    }

    public function test_sharee_dismiss_keeps_thread_entries(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $this->comment('alice', $taskId, 'Kept')->assertCreated();

        $this->asUser('alice')->deleteJson('/api/v1/tasks/tasklists/'.$this->listIdFor('alice', 'Groceries'))->assertOk();

        $this->assertSame(1, $this->entryCount());
        $this->assertSame(['Kept'], array_column($this->entries('bob', $taskId), 'body'));
    }
}
