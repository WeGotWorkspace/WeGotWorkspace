<?php

declare(strict_types=1);

namespace Tests\Feature\Threads;

use App\Models\ThreadIndex;
use App\Services\Threads\ThreadLifecycle;
use App\Services\Threads\ThreadSubjectRegistry;
use Illuminate\Testing\TestResponse;
use Tests\Support\Threads\FakeThreadSubject;
use Tests\Support\Threads\TaskThreadFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The shared thread layer with a subject type that is not a task (#2173,
 * plan.md "The shared thread layer has no task code"), plus the API rules
 * every subject type gets: idempotent posts, the post order, arrival order.
 *
 * Note "n1" lives in book "red", owned by bob; alice may post, carol only reads.
 */
final class ThreadServiceWithFakeSubjectTest extends WgwDatabaseTestCase
{
    use TaskThreadFixtures;

    private FakeThreadSubject $notes;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedWgwUser('dave', displayName: 'Dave');
        $this->notes = new FakeThreadSubject;
        $this->notes->put('n1', 'red', 'principals/bob', ['bob' => true, 'alice' => true, 'carol' => false]);
        app(ThreadSubjectRegistry::class)->register($this->notes);
    }

    public function test_post_list_and_react_work_for_a_non_task_subject(): void
    {
        $root = $this->postNote('alice', 'n1', 'Hello @bob', ['mentions' => [['id' => 'bob'], ['id' => 'dave']]])->assertCreated()->json();
        $this->postNote('bob', 'n1', 'Hi', ['parentId' => $root['id']])->assertCreated()->assertJsonPath('kind', 'reply');
        $this->asUser('bob')->postJson($this->url('n1', 'entries/'.$root['id'].'/reactions'), ['emoji' => '👍'])
            ->assertOk()
            ->assertJsonPath('reactions.0.authors', ['bob']);

        $page = $this->asUser('carol')->getJson($this->url('n1', 'entries'))->assertOk();
        $page->assertJsonPath('canPost', false)
            ->assertJsonPath('list.0.author.displayName', 'Alice')
            ->assertJsonPath('list.0.kind', 'comment')
            ->assertJsonPath('list.0.mentions', [['id' => 'bob', 'displayName' => 'Bob']])
            ->assertJsonPath('list.1.parentId', $root['id']);
        $this->assertSame('fakenote', ThreadIndex::query()->value('subject_type'));
        $this->asUser('dave')->getJson($this->url('n1', 'entries'))->assertNotFound();
        $this->asUser('bob')->getJson('/api/v1/threads/nosuchtype/n1/entries')->assertNotFound();
    }

    public function test_post_with_the_same_ulid_twice_stores_one_entry(): void
    {
        $id = $this->ulid();
        $this->postNote('alice', 'n1', 'Once', ['id' => $id])->assertCreated();
        $this->postNote('alice', 'n1', 'Once', ['id' => $id])->assertOk()->assertJsonPath('id', $id);

        $this->assertSame(1, $this->entryCount());
    }

    public function test_post_with_a_stale_scope_id_is_409_and_stores_nothing(): void
    {
        $this->postNote('alice', 'n1', 'Moved meanwhile', ['scopeId' => 'book-blue'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'subject_moved');
        $this->postNote('alice', 'n1', 'Same place', ['scopeId' => 'book-red'])->assertCreated();

        $this->assertSame(1, $this->entryCount());
    }

    public function test_retry_of_a_stored_id_after_a_move_is_already_stored_and_writes_nothing(): void
    {
        $id = $this->ulid();
        $this->postNote('alice', 'n1', 'Before the move', ['id' => $id])->assertCreated();
        $this->notes->move('n1', 'blue');

        $this->postNote('alice', 'n1', 'Before the move', ['id' => $id, 'scopeId' => 'book-red'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'already_stored')
            ->assertJsonMissingPath('id');
        $this->assertSame([], $this->asUser('alice')->getJson($this->url('n1', 'entries'))->json('list'));
        $this->assertSame(1, $this->entryCount());
    }

    public function test_a_ulid_taken_by_another_person_gets_a_fresh_id(): void
    {
        $id = $this->ulid();
        $this->postNote('alice', 'n1', 'Mine', ['id' => $id])->assertCreated();

        $fresh = $this->postNote('bob', 'n1', 'Also mine', ['id' => $id])->assertCreated()->json('id');

        $this->assertNotSame($id, $fresh);
        $this->assertSame(2, $this->entryCount());
    }

    public function test_entries_sort_by_arrival_not_by_ulid_time(): void
    {
        $this->postNote('alice', 'n1', 'Written online', ['id' => '01J6Y6M0R2V9GKJ4W1T8Q3ZZZZ'])->assertCreated();
        $this->postNote('alice', 'n1', 'Written offline long ago', ['id' => '01A00000000000000000000000'])->assertCreated();

        $bodies = array_column((array) $this->asUser('bob')->getJson($this->url('n1', 'entries'))->json('list'), 'body');
        $this->assertSame(['Written online', 'Written offline long ago'], $bodies);
    }

    public function test_read_only_reader_gets_403_on_every_write_and_writes_nothing(): void
    {
        $root = $this->postNote('alice', 'n1', 'Root')->assertCreated()->json('id');
        $before = $this->entryCount();

        $this->postNote('carol', 'n1', 'Nope')->assertForbidden();
        $this->asUser('carol')->postJson($this->url('n1', 'entries/'.$root.'/reactions'), ['emoji' => '👍'])->assertForbidden();
        $this->asUser('carol')->patchJson($this->url('n1', 'entries/'.$root), ['body' => 'x'])->assertForbidden();
        $this->asUser('carol')->deleteJson($this->url('n1', 'entries/'.$root))->assertForbidden();

        $this->assertSame($before, $this->entryCount());
        $this->asUser('bob')->getJson($this->url('n1', 'entries'))->assertJsonPath('list.0.reactions', []);
    }

    public function test_reply_to_a_reply_or_to_another_key_is_422(): void
    {
        $root = $this->postNote('alice', 'n1', 'Root')->assertCreated()->json('id');
        $reply = $this->postNote('bob', 'n1', 'Reply', ['parentId' => $root])->assertCreated()->json('id');
        $this->notes->put('n2', 'red', 'principals/bob', ['alice' => true]);

        $this->postNote('alice', 'n1', 'Deeper', ['parentId' => $reply])->assertStatus(422);
        $this->postNote('alice', 'n2', 'Elsewhere', ['parentId' => $root])->assertStatus(422);
        $this->assertSame(2, $this->entryCount());
    }

    public function test_only_the_author_edits_and_deletes_and_delete_leaves_a_tombstone(): void
    {
        $root = $this->postNote('alice', 'n1', 'Typo')->assertCreated()->json('id');
        $this->postNote('bob', 'n1', 'Reply', ['parentId' => $root])->assertCreated();

        $this->asUser('bob')->patchJson($this->url('n1', 'entries/'.$root), ['body' => 'Hijack'])->assertForbidden();
        $this->asUser('alice')->patchJson($this->url('n1', 'entries/'.$root), ['body' => 'Fixed'])
            ->assertOk()
            ->assertJsonPath('body', 'Fixed')
            ->assertJsonPath('editedAt', fn ($value) => is_string($value));
        $this->asUser('alice')->deleteJson($this->url('n1', 'entries/'.$root))->assertOk()->assertJsonPath('body', null);
        $this->asUser('alice')->deleteJson($this->url('n1', 'entries/'.$root))->assertOk();
        $this->asUser('alice')->patchJson($this->url('n1', 'entries/'.$root), ['body' => 'Back'])->assertStatus(409);

        $list = $this->asUser('bob')->getJson($this->url('n1', 'entries'))->json('list');
        $this->assertCount(2, $list);
        $this->assertNotNull($list[0]['deletedAt']);
    }

    public function test_changes_return_entries_changed_since_a_state(): void
    {
        $first = $this->postNote('alice', 'n1', 'One')->assertCreated()->json('id');
        $state = (string) $this->asUser('bob')->getJson($this->url('n1', 'entries'))->json('state');
        $second = $this->postNote('bob', 'n1', 'Two')->assertCreated()->json('id');
        $this->asUser('bob')->postJson($this->url('n1', 'entries/'.$first.'/reactions'), ['emoji' => '🎉'])->assertOk();

        $changes = $this->asUser('carol')->getJson($this->url('n1', 'changes').'?since='.$state)->assertOk();
        $this->assertEqualsCanonicalizing([$first, $second], $changes->json('changed'));
        $this->asUser('carol')->getJson($this->url('n1', 'changes').'?since='.$changes->json('newState'))
            ->assertOk()
            ->assertJsonPath('changed', []);
    }

    public function test_thread_full_is_409(): void
    {
        $this->postNote('alice', 'n1', 'One')->assertCreated();
        $rows = ThreadIndex::query()->firstOrFail()->toArray();
        unset($rows['id']);
        $filler = [];
        for ($i = 1; $i < 5000; $i++) {
            $filler[] = [...$rows, 'uid' => 'F'.str_pad((string) $i, 25, '0', STR_PAD_LEFT)];
        }
        foreach (array_chunk($filler, 500) as $chunk) {
            ThreadIndex::query()->insert($chunk);
        }

        $this->postNote('alice', 'n1', 'Too many')->assertStatus(409)->assertJsonPath('code', 'thread_full');
    }

    public function test_scope_deleted_keeps_other_subject_types_in_the_same_scope(): void
    {
        $this->postNote('alice', 'n1', 'Fake note comment')->assertCreated();
        $row = ThreadIndex::query()->firstOrFail();
        $row->replicate()->fill(['uid' => $this->ulid(), 'subject_type' => 'other', 'created_at' => $row->created_at])->save();

        app(ThreadLifecycle::class)->scopeDeleted('other', 'red');

        $this->assertSame(['fakenote'], ThreadIndex::query()->pluck('subject_type')->all());
        $this->assertCount(1, $this->asUser('bob')->getJson($this->url('n1', 'entries'))->json('list'));

        app(ThreadLifecycle::class)->scopeDeleted('fakenote', 'red');
        $this->assertSame([], $this->asUser('bob')->getJson($this->url('n1', 'entries'))->json('list'));
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function postNote(string $username, string $noteId, string $body, array $extra = []): TestResponse
    {
        return $this->asUser($username)->postJson($this->url($noteId, 'entries'), ['id' => $extra['id'] ?? $this->ulid(), 'body' => $body, ...$extra]);
    }

    private function url(string $noteId, string $suffix): string
    {
        return $this->threadUrl($noteId, $suffix, FakeThreadSubject::TYPE);
    }
}
