<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarObject;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Testing\TestResponse;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Assignee ids and validation on REST writes (#2172).
 *
 * bob owns "Groceries", shared with alice (write) and carol (read). dave is in
 * no Team and cannot see the list. All four share Team "crew" except dave.
 */
final class TaskAssigneeValidationTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    private string $listId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedWgwUser('dave', displayName: 'Dave');
        $this->seedInboxTaskListFor('alice');
        $this->seedInboxTaskListFor('dave');
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

    public function test_assigning_a_writer_stores_their_account_on_the_attendee(): void
    {
        $taskId = $this->createTask();

        $response = $this->patchTask($taskId, ['participants' => [
            // The server writes alice's own address and name, whatever the payload says.
            'u:alice' => ['@type' => 'Participant', 'roles' => ['attendee'], 'email' => 'someone@else.test', 'name' => 'Mallory'],
        ]]);

        $response->assertOk()
            ->assertJsonPath('participants.u:alice.username', 'alice')
            ->assertJsonPath('participants.u:alice.email', 'alice@example.test')
            ->assertJsonPath('participants.u:alice.name', 'Alice')
            ->assertJsonPath('participants.u:alice.roles', ['attendee']);
        $ics = $this->storedIcs($taskId);
        $this->assertStringContainsString('X-WGW-USERNAME=alice', $ics);
        $this->assertStringContainsString('mailto:alice@example.test', $ics);
        $this->assertStringNotContainsString('ORGANIZER', $ics);
    }

    public function test_adding_a_reader_or_outsider_is_422(): void
    {
        $taskId = $this->createTask();

        foreach (['u:carol', 'u:dave', 'u:nobody'] as $id) {
            $this->patchTask($taskId, ['participants' => [$id => ['@type' => 'Participant', 'roles' => ['attendee']]]])
                ->assertStatus(422)
                ->assertJsonPath('code', 'invalid_participant');
        }
        $this->asUser('bob')->getJson('/api/v1/tasks/items/'.$taskId)->assertOk()->assertJsonMissingPath('participants');
    }

    public function test_an_email_id_of_a_user_is_checked_as_that_user(): void
    {
        $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload($this->listId),
            'participants' => ['e:dave@example.test' => ['@type' => 'Participant', 'email' => 'dave@example.test', 'roles' => ['attendee']]],
        ])->assertStatus(422)->assertJsonPath('code', 'invalid_participant');
    }

    public function test_create_with_external_attendee_succeeds(): void
    {
        $participants = $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload($this->listId),
            'participants' => ['p1' => ['@type' => 'Participant', 'email' => 'Guest@Outside.test', 'roles' => ['attendee']]],
        ])->assertCreated()->json('participants');

        $this->assertSame(['e:guest@outside.test'], array_keys($participants));
        $this->assertSame('Guest@Outside.test', $participants['e:guest@outside.test']['email']);
        $this->assertNull($participants['e:guest@outside.test']['username']);
    }

    public function test_put_resending_an_existing_external_attendee_succeeds(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'thunderbird.ics', $this->vtodoWith(
            "ATTENDEE;CN=Guest;RSVP=TRUE:mailto:guest@outside.test\r\n"
            ."ATTENDEE;CN=Dave;RSVP=TRUE:mailto:dave@example.test\r\n"
        ), $this->listId);
        $url = '/api/v1/tasks/items/'.$taskId;
        $task = $this->asUser('bob')->getJson($url)->assertOk()->json();
        $this->assertSame(['e:guest@outside.test', 'u:dave'], array_keys($task['participants']));

        $this->asUser('bob')->putJson($url, [
            'taskListIds' => [$this->listId => true],
            'title' => 'Renamed',
            'participants' => $task['participants'],
        ], $this->withIfMatch((string) $task['etag']))->assertOk();

        $ics = $this->storedIcs($taskId);
        $this->assertSame(2, substr_count($ics, 'RSVP=TRUE'));
    }

    public function test_move_keeps_assignees_without_access_in_the_target_list(): void
    {
        $taskId = $this->createTask();
        $assigned = $this->patchTask($taskId, ['participants' => [
            'u:alice' => ['@type' => 'Participant', 'roles' => ['attendee']],
        ]])->assertOk()->json();

        // bob's inbox is not shared with alice.
        $this->asUser('bob')->putJson('/api/v1/tasks/items/'.$taskId, [
            'taskListIds' => [InboxTaskListProvisioner::URI => true],
            'title' => 'Moved',
            'participants' => $assigned['participants'],
        ], $this->withIfMatch((string) $assigned['etag']))
            ->assertOk()
            ->assertJsonPath('taskListId', InboxTaskListProvisioner::URI)
            ->assertJsonPath('participants.u:alice.username', 'alice');
    }

    public function test_unassigning_one_person_keeps_the_others(): void
    {
        $taskId = $this->createTask();
        $this->patchTask($taskId, ['participants' => [
            'u:alice' => ['@type' => 'Participant', 'roles' => ['attendee']],
            'u:bob' => ['@type' => 'Participant', 'roles' => ['attendee']],
        ]])->assertOk();

        $this->patchTask($taskId, ['participants' => ['u:alice' => null]])
            ->assertOk()
            ->assertJsonMissingPath('participants.u:alice')
            ->assertJsonPath('participants.u:bob.username', 'bob');
    }

    public function test_positional_participant_id_in_a_patch_is_422(): void
    {
        $taskId = $this->createTask();

        $this->patchTask($taskId, ['participants' => ['att1' => null]])
            ->assertStatus(422)
            ->assertJsonPath('code', 'stale_participant_id');
    }

    public function test_a_writer_sharee_can_assign_the_owner(): void
    {
        $taskId = $this->createTask();
        $aliceListId = (string) collect($this->asUser('alice')->getJson('/api/v1/tasks/tasklists')->json('list'))
            ->firstWhere('name', 'Groceries')['id'];
        $this->assertNotSame('', $aliceListId);
        $url = '/api/v1/tasks/items/'.$taskId;
        $etag = (string) $this->asUser('alice')->getJson($url)->assertOk()->json('etag');

        $this->asUser('alice')->patchJson($url, ['participants' => [
            'u:bob' => ['@type' => 'Participant', 'roles' => ['attendee']],
        ]], $this->withIfMatch($etag))->assertOk()->assertJsonPath('participants.u:bob.username', 'bob');
    }

    private function createTask(): string
    {
        return (string) $this->asUser('bob')
            ->postJson('/api/v1/tasks/items', $this->sampleTaskCreatePayload($this->listId))
            ->assertCreated()
            ->json('id');
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function patchTask(string $taskId, array $patch): TestResponse
    {
        $url = '/api/v1/tasks/items/'.$taskId;
        $etag = (string) $this->asUser('bob')->getJson($url)->assertOk()->json('etag');

        return $this->asUser('bob')->patchJson($url, $patch, $this->withIfMatch($etag));
    }

    private function storedIcs(string $taskId): string
    {
        $object = CalendarObject::query()->where('uri', explode('#', $taskId)[0].'.ics')->firstOrFail();

        return str_replace("\r\n ", '', (string) $object->calendardata);
    }

    private function vtodoWith(string $lines): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mozilla//Thunderbird//EN\r\n"
            ."BEGIN:VTODO\r\nUID:tb-1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:From Thunderbird\r\n"
            .$lines."END:VTODO\r\nEND:VCALENDAR\r\n";
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($username === 'bob' ? $this->userBearerToken() : $this->issueBearerTokenFor($username));
    }
}
