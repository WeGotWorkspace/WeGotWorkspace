<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarObject;
use App\Models\SearchDocument;
use App\Models\TaskYjsState;
use App\Services\Collab\CollabExternalWrite;
use App\Services\Tasks\TaskTextFields;
use Illuminate\Testing\TestResponse;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Live title and description of a task (#2208): the text resource, its
 * stored Yjs state, and the locked write every task write now shares.
 */
final class TaskTextCollaborationTest extends WgwDatabaseTestCase
{
    use SendsFramedCollaboration;
    use TasksTestFixtures;

    private const STATE = "\x00\x01\x02\xff";

    private const UID = 'urn:uuid:3c1f0d6e-6d0a-4c43-9b8e-6f6a1d2b7c11';

    private const OBJECT_URI = 'live-text.ics';

    private string $taskId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->taskId = $this->seedTaskViaPdo('bob', self::OBJECT_URI, $this->todo('Plan', 'First notes'));
    }

    public function test_the_text_resource_names_the_room_and_both_tags(): void
    {
        $response = $this->readText()->assertOk()
            ->assertJsonPath('title', 'Plan')
            ->assertJsonPath('description', 'First notes');

        $object = $this->object();
        $this->assertSame('task:'.$object->calendarid.':'.self::UID, $response->json('room'));
        $this->assertSame('"'.$object->etag.'"', $response->json('objectEtag'));
        $this->assertSame('"'.sha1("First notes\0Plan").'"', $response->headers->get('ETag'));
    }

    public function test_a_task_with_no_state_reads_as_204(): void
    {
        $this->readState()->assertNoContent();
    }

    public function test_a_first_save_must_name_the_text_it_started_from(): void
    {
        $this->save('Plan', 'Typed', ['If-None-Match' => '*'])
            ->assertStatus(428)
            ->assertJsonPath('code', 'precondition_required');

        $this->assertSame('First notes', $this->readText()->json('description'));
    }

    public function test_a_first_save_over_a_native_edit_since_the_read_is_refused(): void
    {
        $seededFrom = (string) $this->readText()->headers->get('ETag');
        $this->updateTaskViaPdo('bob', self::OBJECT_URI, $this->todo('Plan', 'From Reminders'));

        $this->save('Plan', 'Typed', ['If-None-Match' => '*', CollabExternalWrite::HEADER => $seededFrom])
            ->assertStatus(409)
            ->assertJsonPath('error', 'external_write');

        $this->assertSame('From Reminders', $this->readText()->json('description'));
        $this->assertSame(0, TaskYjsState::query()->count());
    }

    public function test_a_first_save_lands_and_stores_the_state(): void
    {
        $response = $this->firstSave('Plan, renamed', 'Typed together');

        $response->assertOk()->assertJsonPath('ok', true);
        $this->assertSame('"'.sha1(self::STATE).'"', $response->headers->get('ETag'));
        $this->readText()->assertJsonPath('title', 'Plan, renamed')->assertJsonPath('description', 'Typed together');
        $state = $this->readState()->assertOk();
        $this->assertSame(self::STATE, $state->getContent());
        $state->assertHeaderMissing(CollabExternalWrite::HEADER);
        $this->assertSame(self::UID, TaskYjsState::query()->sole()->vtodo_uid);
    }

    public function test_a_text_save_runs_the_shared_task_write_path(): void
    {
        $this->firstSave('Searchable new title', 'Typed together')->assertOk();

        // Re-indexed like a REST PATCH; the task ETag and status are untouched otherwise.
        $this->assertSame(1, SearchDocument::query()->where('object_id', (int) $this->object()->id)->where('title', 'Searchable new title')->count());
        $this->showTask()->assertJsonPath('title', 'Searchable new title')->assertJsonPath('workflowStatus', 'needs-action');
    }

    public function test_an_empty_description_removes_it(): void
    {
        $this->firstSave('Plan', '')->assertOk();

        $this->assertStringNotContainsString('DESCRIPTION', (string) $this->object()->calendardata);
        $this->readText()->assertJsonPath('description', '');
    }

    public function test_state_preconditions(): void
    {
        $this->firstSave('Plan', 'One')->assertOk();

        $this->save('Plan', 'Two', [])->assertStatus(428);
        $this->save('Plan', 'Two', ['If-None-Match' => '*'])->assertStatus(412);
        $this->save('Plan', 'Two', ['If-Match' => '"stale"'])->assertStatus(412);
        $this->save('Plan', 'Two', ['If-Match' => $this->stateTag()])->assertOk();
    }

    public function test_a_status_change_is_not_an_outside_write(): void
    {
        $this->firstSave('Plan', 'One')->assertOk();
        $this->patchTask(['workflowStatus' => 'in-process']);

        $this->readState()->assertOk()->assertHeaderMissing(CollabExternalWrite::HEADER);
        $this->save('Plan', 'Two', ['If-Match' => $this->stateTag()])->assertOk();
        $this->assertStringContainsString('STATUS:IN-PROCESS', (string) $this->object()->calendardata);
    }

    public function test_a_rest_title_edit_is_an_outside_write_the_save_must_name(): void
    {
        $this->firstSave('Plan', 'One')->assertOk();
        $this->patchTask(['title' => 'From MCP']);

        $this->readState()->assertOk()->assertHeader(CollabExternalWrite::HEADER, '1');
        $this->save('Plan', 'Two', ['If-Match' => $this->stateTag()])
            ->assertStatus(409)
            ->assertJsonPath('error', 'external_write');
        $this->save('Plan', 'Two', ['If-Match' => $this->stateTag(), CollabExternalWrite::HEADER => '*'])
            ->assertStatus(409);
        $this->assertSame('From MCP', $this->readText()->json('title'));

        $seen = (string) $this->readText()->headers->get('ETag');
        $this->save('Plan', 'Two', ['If-Match' => $this->stateTag(), CollabExternalWrite::HEADER => $seen])->assertOk();
        $this->readState()->assertOk()->assertHeaderMissing(CollabExternalWrite::HEADER);
    }

    public function test_the_object_etag_moves_on_a_write_that_restores_an_earlier_text(): void
    {
        $before = $this->readText()->json('objectEtag');
        $this->updateTaskViaPdo('bob', self::OBJECT_URI, $this->todo('Plan', 'Other'));
        // A client writing back the earlier text stamps the object again.
        $this->updateTaskViaPdo('bob', self::OBJECT_URI, str_replace('DTSTAMP:20261118T000000Z', 'DTSTAMP:20261118T000100Z', $this->todo('Plan', 'First notes')));

        $after = $this->readText();
        $this->assertNotSame($before, $after->json('objectEtag'));
        $this->assertSame('"'.sha1("First notes\0Plan").'"', $after->headers->get('ETag'));
    }

    public function test_limits(): void
    {
        $this->firstSave(' ', 'Body')->assertStatus(422)->assertJsonPath('code', 'title_required');
        // Over the field limits: the same validation error a task PATCH gives.
        $this->firstSave(str_repeat('t', 4097), 'Body')->assertStatus(400);
        $this->firstSave('Plan', str_repeat('d', 8193))->assertStatus(400);

        $seen = (string) $this->readText()->headers->get('ETag');
        $this->putCollaborationAs('bob', 'Body', str_repeat("\x01", TaskTextFields::MAX_STATE_BYTES + 1), 'Plan', [
            'If-None-Match' => '*',
            CollabExternalWrite::HEADER => $seen,
        ])->assertStatus(413)->assertJsonPath('code', 'state_too_large');
        $this->assertSame('First notes', $this->readText()->json('description'));
    }

    public function test_access(): void
    {
        $this->readText('carol')->assertNotFound();
        $this->readState('carol')->assertNotFound();
        $this->putCollaborationAs('carol', 'Body', self::STATE, 'Plan', ['If-None-Match' => '*'])->assertNotFound();

        $listId = $this->sharedList(write: false);
        $taskId = $this->seedTaskViaPdo('bob', 'shared.ics', $this->todo('Shared', 'Read me', 'shared-uid'), $listId);
        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->getJson($this->textUrl($taskId))
            ->assertOk()
            ->assertJsonPath('title', 'Shared');
        $seen = (string) $this->withBearer($this->issueBearerTokenFor('carol'))->getJson($this->textUrl($taskId))->headers->get('ETag');
        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->putCollaboration($this->textUrl($taskId), 'Mine now', self::STATE, [
                'If-None-Match' => '*',
                CollabExternalWrite::HEADER => $seen,
            ], 'Shared')
            ->assertForbidden();
    }

    public function test_a_second_vtodo_added_by_a_native_client_keeps_the_first_tasks_state(): void
    {
        $this->taskId = $this->seedTaskViaPdo('bob', 'multi.ics', $this->todo('First', 'One', 'multi-first'));
        $this->firstSave('First', 'Typed')->assertOk();
        $current = (string) CalendarObject::query()->where('uri', 'multi.ics')->firstOrFail()->calendardata;
        $second = "BEGIN:VTODO\r\nUID:multi-second\r\nSUMMARY:Second\r\nEND:VTODO\r\n";
        $this->updateTaskViaPdo('bob', 'multi.ics', str_replace("END:VCALENDAR\r\n", $second."END:VCALENDAR\r\n", $current));

        // The first task is now `multi#multi-first`; its state row is keyed by its own UID.
        $this->taskId = 'multi#multi-first';
        $state = $this->readState()->assertOk();
        $this->assertSame(self::STATE, $state->getContent());
        $state->assertHeaderMissing(CollabExternalWrite::HEADER);
        $this->taskId = 'multi#multi-second';
        $this->readState()->assertNoContent();
    }

    public function test_a_patch_that_read_the_task_before_a_text_save_is_refused_and_lands_on_retry(): void
    {
        $this->firstSave('Plan', 'One')->assertOk();
        $staleEtag = (string) $this->showTask()->json('etag');
        $stateTag = $this->stateTag();

        // The text save lands between the PATCH's unlocked lookup and its write.
        $interleaved = false;
        CalendarObject::retrieved(function () use (&$interleaved, $stateTag): void {
            if ($interleaved) {
                return;
            }
            $interleaved = true;
            $this->save('Plan', 'Typed meanwhile', ['If-Match' => $stateTag])->assertOk();
        });

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->withHeader('If-Match', $staleEtag)
            ->patchJson($this->taskUrl(), ['workflowStatus' => 'completed'])
            ->assertStatus(412);
        $this->assertTrue($interleaved);
        $this->assertSame('Typed meanwhile', $this->readText()->json('description'));

        $this->patchTask(['workflowStatus' => 'completed']);
        $this->assertSame('Typed meanwhile', $this->readText()->json('description'));
        $this->assertStringContainsString('STATUS:COMPLETED', (string) $this->object()->calendardata);
    }

    public function test_a_task_id_with_a_urn_uid_reaches_the_text_routes(): void
    {
        $uid = 'urn:uuid:9a1b2c3d-0000-4000-8000-000000000001';
        $this->taskId = $this->seedTaskViaPdo('bob', 'urn.ics', $this->todo('First', 'One', $uid));
        $current = (string) CalendarObject::query()->where('uri', 'urn.ics')->firstOrFail()->calendardata;
        $second = "BEGIN:VTODO\r\nUID:urn:uuid:9a1b2c3d-0000-4000-8000-000000000002\r\nSUMMARY:Second\r\nEND:VTODO\r\n";
        $this->updateTaskViaPdo('bob', 'urn.ics', str_replace("END:VCALENDAR\r\n", $second."END:VCALENDAR\r\n", $current));

        $this->taskId = 'urn.ics#'.$uid;
        $this->readText()->assertOk()->assertJsonPath('title', 'First');
        $this->firstSave('First', 'Typed')->assertOk();
        $this->showTask();
    }

    public function test_moving_a_task_leaves_its_state_and_deleted_text_behind(): void
    {
        // Stand-in for a Yjs update that still holds text deleted in list A.
        $history = "\x01wiped from list A\x02";
        $this->putCollaborationAs('bob', 'Typed', $history, 'Plan', [
            'If-None-Match' => '*',
            CollabExternalWrite::HEADER => (string) $this->readText()->headers->get('ETag'),
        ])->assertOk();
        $sourceId = (int) CalendarObject::query()->where('uri', self::OBJECT_URI)->value('id');
        $this->assertSame(1, TaskYjsState::query()->where('calendar_object_id', $sourceId)->count());
        $workId = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Work'])
            ->assertCreated()
            ->json('id');
        $etag = (string) $this->showTask()->json('etag');

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->withHeader('If-Match', $etag)
            ->putJson($this->taskUrl(), ['taskListIds' => [$workId => true], 'title' => 'Plan', 'description' => 'Typed'])
            ->assertOk()
            ->assertJsonPath('taskListId', $workId);
        $this->flushHeaders();

        // The text moves as plain VTODO text; the state, and the deleted text in it, do not.
        $this->readText()->assertOk()->assertJsonPath('description', 'Typed');
        $this->readState()->assertNoContent();
        $this->assertSame(0, TaskYjsState::query()->where('calendar_object_id', $sourceId)->count());
        $this->assertSame(0, TaskYjsState::query()->count());
        // The next save in list B seeds afresh and must name the text it read.
        $this->firstSave('Plan', 'Typed again')->assertOk();
        $this->assertSame(self::STATE, $this->readState()->assertOk()->getContent());
    }

    public function test_a_delete_with_a_stale_etag_is_refused_and_keeps_the_other_tasks_text(): void
    {
        $this->taskId = $this->seedTaskViaPdo('bob', 'multi.ics', $this->todo('First', 'One', 'multi-first'));
        $current = (string) CalendarObject::query()->where('uri', 'multi.ics')->firstOrFail()->calendardata;
        $second = "BEGIN:VTODO\r\nUID:multi-second\r\nSUMMARY:Second\r\nEND:VTODO\r\n";
        $this->updateTaskViaPdo('bob', 'multi.ics', str_replace("END:VCALENDAR\r\n", $second."END:VCALENDAR\r\n", $current));

        $this->taskId = 'multi#multi-second';
        $staleEtag = (string) $this->showTask()->json('etag');
        $this->taskId = 'multi#multi-first';
        $this->firstSave('First', 'Typed')->assertOk();

        $this->taskId = 'multi#multi-second';
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->withHeader('If-Match', $staleEtag)
            ->deleteJson($this->taskUrl())
            ->assertStatus(412);

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->withHeader('If-Match', (string) $this->showTask()->json('etag'))
            ->deleteJson($this->taskUrl())
            ->assertOk();
        $this->taskId = 'multi#multi-first';
        $this->assertSame('Typed', $this->readText()->json('description'));
        $this->readState()->assertOk();
    }

    public function test_deleting_one_vtodo_keeps_a_text_save_that_landed_after_its_lookup(): void
    {
        $first = 'first-of-two';
        $this->taskId = $this->seedTaskViaPdo('bob', 'pair.ics', $this->todo('First', 'One', $first));
        $this->addSecondVtodo('pair.ics', 'second-of-two');
        $this->taskId = 'pair#'.$first;
        $this->firstSave('First', 'Saved')->assertOk();
        $this->taskId = 'pair#second-of-two';
        $this->firstSave('Second', 'Other')->assertOk();
        $etag = (string) $this->showTask()->json('etag');

        // The first task's text save lands between the delete's lookup and its lock.
        $this->taskId = 'pair#'.$first;
        $this->interleave(fn () => $this->save('First', 'Typed meanwhile', ['If-Match' => $this->stateTag()])->assertOk());
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->withHeader('If-Match', $etag)
            ->deleteJson('/api/v1/tasks/items/'.rawurlencode('pair#second-of-two'))
            ->assertStatus(412);
        $this->flushHeaders();
        $this->assertSame('Typed meanwhile', $this->readText()->json('description'));

        $etag = (string) $this->showTask()->json('etag');
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->withHeader('If-Match', $etag)
            ->deleteJson('/api/v1/tasks/items/'.rawurlencode('pair#second-of-two'))
            ->assertOk();
        $this->flushHeaders();
        $this->assertSame('Typed meanwhile', $this->readText()->json('description'));
        $this->assertSame([$first], TaskYjsState::query()->pluck('vtodo_uid')->all());
    }

    public function test_a_vtodo_without_a_uid_still_takes_ordinary_writes(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Raw//EN\r\nBEGIN:VTODO\r\nSUMMARY:No UID\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        $this->taskId = $this->seedTaskViaPdo('bob', 'no-uid.ics', $ics);

        $this->patchTask(['workflowStatus' => 'completed']);
        $this->readText()->assertNotFound();
    }

    public function test_an_id_naming_a_vtodo_the_file_lacks_is_not_found_and_changes_nothing(): void
    {
        $this->taskId = $this->seedTaskViaPdo('bob', 'pair.ics', $this->todo('First', 'One', 'first-of-two'));
        $this->addSecondVtodo('pair.ics', 'second-of-two');
        $this->taskId = 'pair#first-of-two';
        $this->firstSave('First', 'Saved')->assertOk();
        $this->taskId = 'pair#second-of-two';
        $this->firstSave('Second', 'Other')->assertOk();
        $before = (string) CalendarObject::query()->where('uri', 'pair.ics')->firstOrFail()->calendardata;
        $etag = (string) $this->showTask()->json('etag');

        $this->taskId = 'pair#no-such-uid';
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->withHeader('If-Match', $etag)
            ->deleteJson($this->taskUrl())
            ->assertNotFound();
        $this->readState()->assertNotFound();

        $this->assertSame($before, (string) CalendarObject::query()->where('uri', 'pair.ics')->firstOrFail()->calendardata);
        $this->assertSame(2, TaskYjsState::query()->count());
    }

    /** Run `$write` once, the next time a task row is read: between a write's lookup and its lock. */
    private function interleave(callable $write): void
    {
        $done = false;
        CalendarObject::retrieved(function () use (&$done, $write): void {
            if ($done) {
                return;
            }
            $done = true;
            $write();
        });
    }

    private function addSecondVtodo(string $objectUri, string $uid): void
    {
        $current = (string) CalendarObject::query()->where('uri', $objectUri)->firstOrFail()->calendardata;
        $second = "BEGIN:VTODO\r\nUID:{$uid}\r\nDTSTAMP:20261118T000000Z\r\nSUMMARY:Second\r\nEND:VTODO\r\n";
        $this->updateTaskViaPdo('bob', $objectUri, str_replace("END:VCALENDAR\r\n", $second."END:VCALENDAR\r\n", $current));
    }

    private function todo(string $summary, string $description, string $uid = self::UID): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Reminders//EN\r\nBEGIN:VTODO\r\nUID:{$uid}\r\n"
            ."DTSTAMP:20261118T000000Z\r\nSUMMARY:{$summary}\r\nDESCRIPTION:{$description}\r\nSTATUS:NEEDS-ACTION\r\n"
            ."END:VTODO\r\nEND:VCALENDAR\r\n";
    }

    private function firstSave(string $title, string $description): TestResponse
    {
        $seen = (string) $this->readText()->headers->get('ETag');

        return $this->save($title, $description, ['If-None-Match' => '*', CollabExternalWrite::HEADER => $seen]);
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function save(string $title, string $description, array $headers): TestResponse
    {
        return $this->putCollaborationAs('bob', $description, self::STATE, $title, $headers);
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function putCollaborationAs(string $user, string $description, string $state, string $title, array $headers): TestResponse
    {
        $previous = $this->defaultHeaders;
        try {
            return $this->withBearer($this->issueBearerTokenFor($user))
                ->putCollaboration($this->textUrl($this->taskId), $description, $state, $headers, $title);
        } finally {
            $this->defaultHeaders = $previous;
        }
    }

    private function readText(string $user = 'bob'): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor($user))->getJson($this->textUrl($this->taskId));
    }

    private function readState(string $user = 'bob'): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor($user))->get($this->textUrl($this->taskId).'?format=yjs');
    }

    private function showTask(): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'))->getJson($this->taskUrl())->assertOk();
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function patchTask(array $patch): void
    {
        $etag = (string) $this->showTask()->json('etag');
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->withHeader('If-Match', $etag)
            ->patchJson($this->taskUrl(), $patch)
            ->assertOk();
    }

    private function stateTag(): string
    {
        return '"'.sha1(self::STATE).'"';
    }

    private function sharedList(bool $write): string
    {
        $this->seedSharedTeamForEveryone();
        $listId = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Team'])
            ->assertCreated()
            ->json('id');
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, [
                'shareWith' => ['carol' => $write ? ['mayWriteAll' => true] : ['mayReadItems' => true]],
            ])
            ->assertOk();

        return $listId;
    }

    private function object(): CalendarObject
    {
        return CalendarObject::query()->where('uri', self::OBJECT_URI)->firstOrFail();
    }

    private function taskUrl(): string
    {
        return '/api/v1/tasks/items/'.rawurlencode($this->taskId);
    }

    private function textUrl(string $taskId): string
    {
        return '/api/v1/tasks/items/'.rawurlencode($taskId).'/text';
    }
}
