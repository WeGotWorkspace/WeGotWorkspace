<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\ThreadIndex;
use Tests\Support\Threads\TaskThreadFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Who reads and writes a task thread (#2173, spec.md "Thread API", Access).
 * bob owns "Groceries", alice writes, carol reads, dave sees nothing.
 */
final class TaskThreadAccessTest extends WgwDatabaseTestCase
{
    use TaskThreadFixtures;

    private string $listId;

    private string $taskId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTaskThreads();
        $this->listId = $this->groceries();
        $this->taskId = $this->createTask('bob', $this->listId, 'Milk');
    }

    public function test_writer_and_reader_see_the_same_thread(): void
    {
        $this->comment('alice', $this->taskId, 'Oat milk?', ['scopeId' => $this->listIdFor('alice', 'Groceries')])->assertCreated();

        $this->asUser('bob')->getJson($this->threadUrl($this->taskId, 'entries'))
            ->assertOk()
            ->assertJsonPath('canPost', true)
            ->assertJsonPath('list.0.body', 'Oat milk?')
            ->assertJsonPath('list.0.author.displayName', 'Alice');
        $this->asUser('carol')->getJson($this->threadUrl($this->taskId, 'entries'))
            ->assertOk()
            ->assertJsonPath('canPost', false)
            ->assertJsonPath('list.0.body', 'Oat milk?');
    }

    public function test_every_thread_route_is_404_without_list_access(): void
    {
        $entryId = $this->comment('bob', $this->taskId, 'Private to the list')->assertCreated()->json('id');
        $dave = $this->asUser('dave');

        $dave->getJson($this->threadUrl($this->taskId, 'entries'))->assertNotFound();
        $dave->getJson($this->threadUrl($this->taskId, 'changes'))->assertNotFound();
        $dave->postJson($this->threadUrl($this->taskId, 'entries'), ['id' => $this->ulid(), 'body' => 'x'])->assertNotFound();
        $dave->patchJson($this->threadUrl($this->taskId, 'entries/'.$entryId), ['body' => 'x'])->assertNotFound();
        $dave->deleteJson($this->threadUrl($this->taskId, 'entries/'.$entryId))->assertNotFound();
        $dave->postJson($this->threadUrl($this->taskId, 'entries/'.$entryId.'/reactions'), ['emoji' => '👍'])->assertNotFound();
        $this->assertSame(1, $this->entryCount());
    }

    public function test_read_only_sharee_reads_but_every_write_is_403(): void
    {
        $entryId = $this->comment('alice', $this->taskId, 'Root')->assertCreated()->json('id');
        $carol = $this->asUser('carol');

        $this->comment('carol', $this->taskId, 'Can I?')->assertForbidden();
        $this->comment('carol', $this->taskId, 'Stale too', ['scopeId' => 'elsewhere'])->assertForbidden();
        $carol->postJson($this->threadUrl($this->taskId, 'entries/'.$entryId.'/reactions'), ['emoji' => '👍'])->assertForbidden();
        $carol->patchJson($this->threadUrl($this->taskId, 'entries/'.$entryId), ['body' => 'x'])->assertForbidden();
        $carol->deleteJson($this->threadUrl($this->taskId, 'entries/'.$entryId))->assertForbidden();

        $this->assertSame(1, $this->entryCount());
        $this->assertCount(1, $this->entries('carol', $this->taskId));
    }

    public function test_read_only_retry_of_the_callers_own_ulid_returns_200_or_already_stored(): void
    {
        $errands = $this->createList('bob', 'Errands');
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$errands, ['shareWith' => ['carol' => ['mayWriteAll' => false]]])->assertOk();
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['shareWith' => ['carol' => ['mayWriteAll' => true]]])->assertOk();
        $id = $this->ulid();
        $this->comment('carol', $this->taskId, 'Written with write access', ['id' => $id])->assertCreated();
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['shareWith' => ['carol' => ['mayWriteAll' => false]]])->assertOk();

        $this->comment('carol', $this->taskId, 'Written with write access', ['id' => $id])->assertOk()->assertJsonPath('id', $id);

        $this->moveTask('bob', $this->taskId, $errands)->assertOk();
        $this->comment('carol', $this->taskId, 'Written with write access', ['id' => $id])
            ->assertStatus(409)
            ->assertJsonPath('code', 'already_stored');
        $this->comment('carol', $this->taskId, 'New one', ['scopeId' => $this->listIdFor('carol', 'Groceries')])->assertForbidden();
        $this->assertSame(1, ThreadIndex::query()->where('kind', '!=', 'activity')->count());
    }

    public function test_moved_task_shows_a_fresh_thread_to_the_new_audience(): void
    {
        $this->comment('alice', $this->taskId, 'For the shared list only')->assertCreated();
        $private = $this->createList('bob', 'Private');

        $this->moveTask('bob', $this->taskId, $private)->assertOk();

        $entries = $this->entries('bob', $this->taskId);
        $this->assertSame(['activity'], array_column($entries, 'kind'));
        $this->assertSame(['field' => 'moved'], $entries[0]['activity']);
        $this->asUser('alice')->getJson($this->threadUrl($this->taskId, 'entries'))->assertNotFound();
    }

    public function test_entry_from_another_list_is_404_and_is_not_written(): void
    {
        $old = $this->comment('bob', $this->taskId, 'Left behind')->assertCreated()->json('id');
        $private = $this->createList('bob', 'Private');
        $this->moveTask('bob', $this->taskId, $private)->assertOk();
        $before = $this->entryCount();

        $this->asUser('bob')->postJson($this->threadUrl($this->taskId, 'entries/'.$old.'/reactions'), ['emoji' => '👍'])->assertNotFound();
        $this->asUser('bob')->patchJson($this->threadUrl($this->taskId, 'entries/'.$old), ['body' => 'Edited'])->assertNotFound();
        $this->asUser('bob')->deleteJson($this->threadUrl($this->taskId, 'entries/'.$old))->assertNotFound();
        $this->comment('bob', $this->taskId, 'Reply to the past', ['parentId' => $old])->assertStatus(422);

        $this->assertSame($before, $this->entryCount());
    }

    public function test_activity_entries_are_read_only(): void
    {
        $private = $this->createList('bob', 'Private');
        $this->moveTask('bob', $this->taskId, $private)->assertOk();
        $activity = $this->entries('bob', $this->taskId)[0]['id'];

        $this->asUser('bob')->patchJson($this->threadUrl($this->taskId, 'entries/'.$activity), ['body' => 'x'])->assertStatus(409);
        $this->asUser('bob')->deleteJson($this->threadUrl($this->taskId, 'entries/'.$activity))->assertStatus(409);
        $this->asUser('bob')->postJson($this->threadUrl($this->taskId, 'entries/'.$activity.'/reactions'), ['emoji' => '👍'])->assertStatus(409);
        $this->comment('bob', $this->taskId, 'Reply to activity', ['parentId' => $activity])->assertStatus(422);
        $this->assertSame(['field' => 'moved'], $this->entries('bob', $this->taskId)[0]['activity']);
    }

    public function test_mentions_outside_the_list_audience_are_not_stored(): void
    {
        $this->comment('bob', $this->taskId, '@alice @dave', ['mentions' => [['id' => 'alice'], ['id' => 'dave']]])
            ->assertCreated()
            ->assertJsonPath('mentions', [['id' => 'alice', 'displayName' => 'Alice']])
            ->assertJsonPath('body', '@alice @dave');
    }
}
