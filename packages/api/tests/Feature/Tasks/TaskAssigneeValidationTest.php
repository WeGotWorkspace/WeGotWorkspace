<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarObject;
use App\Models\Principal;
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

    public function test_an_email_id_of_an_audience_member_is_checked_as_that_member(): void
    {
        // carol can only view the list.
        $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload($this->listId),
            'participants' => ['e:carol@example.test' => ['@type' => 'Participant', 'email' => 'carol@example.test', 'roles' => ['attendee']]],
        ])->assertStatus(422)
            ->assertJsonPath('code', 'invalid_participant')
            ->assertJsonPath('error', 'Only people who can edit this task list can be assigned.');
    }

    public function test_create_does_not_tell_whether_an_address_outside_the_audience_has_an_account(): void
    {
        // dave has an account but cannot see the list; nobody@ has none. Both read the same.
        foreach (['dave@example.test', 'nobody@example.test'] as $email) {
            $participants = $this->asUser('bob')->postJson('/api/v1/tasks/items', [
                ...$this->sampleTaskCreatePayload($this->listId),
                'participants' => ['p1' => ['@type' => 'Participant', 'email' => $email, 'name' => 'Guest', 'roles' => ['attendee']]],
            ])->assertCreated()->json('participants');

            $this->assertSame(['e:'.$email], array_keys($participants));
            $this->assertNull($participants['e:'.$email]['username']);
            $this->assertSame('Guest', $participants['e:'.$email]['name']);
        }
    }

    public function test_a_refused_assignee_is_not_named_in_the_error(): void
    {
        $taskId = $this->createTask();

        foreach (['u:dave', 'u:nobody', 'u:carol'] as $id) {
            $message = (string) $this->patchTask($taskId, ['participants' => [$id => ['@type' => 'Participant', 'roles' => ['attendee']]]])
                ->assertStatus(422)
                ->json('error');
            $this->assertSame('Only people who can edit this task list can be assigned.', $message);
        }
    }

    public function test_a_read_maps_no_address_outside_the_audience_to_an_account(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'thunderbird.ics', $this->vtodoWith(
            "ATTENDEE;CN=Someone:mailto:dave@example.test\r\n"
            ."ATTENDEE;CN=Al:mailto:ALICE@example.test\r\n"
        ), $this->listId);

        $participants = $this->asUser('bob')->getJson('/api/v1/tasks/items/'.$taskId)->assertOk()->json('participants');

        $this->assertSame(['e:dave@example.test', 'u:alice'], array_keys($participants));
        $this->assertNull($participants['e:dave@example.test']['username']);
        $this->assertSame('Someone', $participants['e:dave@example.test']['name']);
        // alice is in the audience: her own profile, not the line's name.
        $this->assertSame('Alice', $participants['u:alice']['name']);
        $this->assertSame('alice@example.test', $participants['u:alice']['email']);
    }

    public function test_a_caldav_username_claim_reads_with_that_persons_own_profile(): void
    {
        // alice writes a line that names her account but shows bob's name and address.
        $taskId = $this->seedTaskViaPdo('bob', 'spoof.ics', $this->vtodoWith(
            "ATTENDEE;X-WGW-USERNAME=alice;CN=Bob Boss:mailto:bob@example.test\r\n"
        ), $this->listId);

        $participants = $this->asUser('carol')->getJson('/api/v1/tasks/items/'.$taskId)
            ->assertOk()
            ->json('participants');

        $this->assertSame(['u:alice'], array_keys($participants));
        $this->assertSame('Alice', $participants['u:alice']['name']);
        $this->assertSame('alice@example.test', $participants['u:alice']['email']);
        $this->assertSame('alice', $participants['u:alice']['username']);
    }

    public function test_a_caldav_username_claim_on_a_member_without_email_does_not_keep_the_line_address(): void
    {
        Principal::query()->where('uri', 'principals/alice')->update(['email' => null]);
        $taskId = $this->seedTaskViaPdo('bob', 'noemail.ics', $this->vtodoWith(
            "ATTENDEE;X-WGW-USERNAME=alice;CN=Other:mailto:mallory@evil.test\r\n"
        ), $this->listId);

        $participant = $this->asUser('bob')->getJson('/api/v1/tasks/items/'.$taskId)
            ->assertOk()
            ->json('participants.u:alice');

        $this->assertSame('Alice', $participant['name']);
        $this->assertNotSame('mallory@evil.test', $participant['email']);
    }

    public function test_a_caldav_username_claim_outside_the_audience_reveals_no_profile(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'claim.ics', $this->vtodoWith(
            "ATTENDEE;X-WGW-USERNAME=dave;CN=Guess:mailto:guess@outside.test\r\n"
        ), $this->listId);

        $participant = $this->asUser('bob')->getJson('/api/v1/tasks/items/'.$taskId)->assertOk()->json('participants.u:dave');

        $this->assertSame('Guess', $participant['name']);
        $this->assertSame('guess@outside.test', $participant['email']);
    }

    public function test_payload_cannot_add_or_replace_the_organizer(): void
    {
        $owner = ['@type' => 'Participant', 'email' => 'dave@example.test', 'name' => 'Dave', 'roles' => ['owner']];

        $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload($this->listId),
            'participants' => ['org' => $owner],
        ])->assertStatus(422)->assertJsonPath('code', 'invalid_participant');

        $taskId = $this->createTask();
        $this->patchTask($taskId, ['participants' => ['x' => $owner]])
            ->assertStatus(422)
            ->assertJsonPath('code', 'invalid_participant');

        $stored = $this->seedTaskViaPdo('bob', 'organized.ics', $this->vtodoWith(
            "ORGANIZER;CN=Bob:mailto:bob@example.test\r\n"
        ), $this->listId);
        $this->patchTask($stored, ['participants' => ['org' => $owner]])
            ->assertOk()
            ->assertJsonPath('participants.org.email', 'bob@example.test');
        $ics = $this->storedIcs($stored);
        $this->assertMatchesRegularExpression('/^ORGANIZER[^\r\n]*:mailto:bob@example\.test/m', $ics);
        $this->assertStringNotContainsString('dave@example.test', $ics);
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
        // dave cannot see the list, so his address reads as an address.
        $this->assertSame(['e:guest@outside.test', 'e:dave@example.test'], array_keys($task['participants']));

        $this->asUser('bob')->putJson($url, [
            'taskListIds' => [$this->listId => true],
            'title' => 'Renamed',
            'participants' => $task['participants'],
        ], $this->withIfMatch((string) $task['etag']))->assertOk();

        $ics = $this->storedIcs($taskId);
        $this->assertSame(2, substr_count($ics, 'RSVP=TRUE'));
    }

    public function test_repointing_a_stored_external_attendee_at_a_user_keeps_the_stored_address(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'thunderbird.ics', $this->vtodoWith(
            "ATTENDEE;CN=Guest:mailto:guest@outside.test\r\n"
        ), $this->listId);

        foreach (['dave@example.test', 'carol@example.test'] as $email) {
            $this->patchTask($taskId, ['participants' => [
                'e:guest@outside.test' => ['@type' => 'Participant', 'email' => $email, 'roles' => ['attendee']],
            ]])->assertOk();
            $ics = $this->storedIcs($taskId);
            $this->assertStringContainsString('mailto:guest@outside.test', $ics);
            $this->assertStringNotContainsString($email, $ics);
        }
    }

    public function test_resending_a_stored_user_with_another_email_keeps_the_profile_address(): void
    {
        $taskId = $this->createTask();
        $this->patchTask($taskId, ['participants' => [
            'u:alice' => ['@type' => 'Participant', 'roles' => ['attendee']],
        ]])->assertOk();

        $this->patchTask($taskId, ['participants' => [
            'u:alice' => ['@type' => 'Participant', 'roles' => ['attendee'], 'email' => 'mallory@x.test'],
        ]])->assertOk();

        $ics = $this->storedIcs($taskId);
        $this->assertStringContainsString('mailto:alice@example.test', $ics);
        $this->assertStringNotContainsString('mallory@x.test', $ics);
    }

    public function test_an_external_id_with_a_members_email_is_checked_as_that_member(): void
    {
        $taskId = $this->createTask();

        $this->patchTask($taskId, ['participants' => [
            'e:nobody@outside.test' => ['@type' => 'Participant', 'email' => 'carol@example.test', 'roles' => ['attendee']],
        ]])->assertStatus(422)->assertJsonPath('code', 'invalid_participant');
    }

    public function test_recurrence_override_participants_add_no_attendee(): void
    {
        $taskId = $this->createTask();

        $this->patchTask($taskId, [
            'recurrenceRules' => [['frequency' => 'weekly']],
            'recurrenceOverrides' => ['2026-06-09T10:00:00' => [
                'title' => 'Moved',
                'participants' => ['u:dave' => ['@type' => 'Participant', 'roles' => ['attendee'], 'email' => 'dave@example.test']],
            ]],
        ])->assertOk();

        $this->assertStringNotContainsString('ATTENDEE', $this->storedIcs($taskId));
    }

    public function test_ics_props_cannot_add_an_attendee(): void
    {
        $taskId = $this->createTask();

        $response = $this->patchTask($taskId, ['icsProps' => ['ATTENDEE' => 'mailto:dave@example.test']])->assertOk();

        $this->assertStringNotContainsString('ATTENDEE', $this->storedIcs($taskId));
        $this->assertEmpty($response->json('participants') ?? []);
    }

    public function test_ics_props_with_a_split_name_cannot_add_an_attendee(): void
    {
        foreach (['.ATTENDEE', 'ATTENDEE;CN=Dave'] as $name) {
            $taskId = $this->createTask();

            $response = $this->patchTask($taskId, ['icsProps' => [$name => 'mailto:dave@example.test']])->assertOk();

            $this->assertStringNotContainsString('ATTENDEE', $this->storedIcs($taskId));
            $this->assertEmpty($response->json('participants') ?? []);
        }
    }

    public function test_ics_props_with_a_split_name_cannot_add_an_organizer_on_create(): void
    {
        $taskId = (string) $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload($this->listId),
            'icsProps' => ['.ORGANIZER' => 'mailto:dave@example.test'],
        ])->assertCreated()->json('id');

        $this->assertStringNotContainsString('ORGANIZER', $this->storedIcs($taskId));
    }

    public function test_ics_props_value_with_a_line_break_cannot_add_an_attendee_on_create(): void
    {
        $response = $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload($this->listId),
            'icsProps' => ['URL' => "http://x\nATTENDEE:mailto:dave@example.test"],
        ])->assertCreated();

        $this->assertDoesNotMatchRegularExpression('/^ATTENDEE[;:]/m', $this->storedIcs((string) $response->json('id')));
        $this->assertEmpty($response->json('participants') ?? []);
    }

    public function test_ics_props_value_with_a_line_break_cannot_add_an_attendee_on_patch(): void
    {
        $taskId = $this->createTask();

        $response = $this->patchTask($taskId, ['icsProps' => ['REPEAT' => "1\nATTENDEE:mailto:dave@example.test"]])->assertOk();

        $this->assertDoesNotMatchRegularExpression('/^ATTENDEE[;:]/m', $this->storedIcs($taskId));
        $this->assertEmpty($response->json('participants') ?? []);
    }

    public function test_ics_props_cannot_add_an_organizer_on_create(): void
    {
        $taskId = (string) $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            ...$this->sampleTaskCreatePayload($this->listId),
            'icsProps' => ['ORGANIZER' => 'mailto:dave@example.test', 'X-CUSTOM-PROP' => 'kept'],
        ])->assertCreated()->json('id');

        $ics = $this->storedIcs($taskId);
        $this->assertStringNotContainsString('ORGANIZER', $ics);
        $this->assertStringContainsString('X-CUSTOM-PROP:kept', $ics);
    }

    public function test_move_to_another_audience_drops_the_assignees_who_cannot_see_it(): void
    {
        $taskId = $this->createTask();
        $this->patchTask($taskId, ['participants' => [
            'u:alice' => ['@type' => 'Participant', 'roles' => ['attendee']],
            'u:bob' => ['@type' => 'Participant', 'roles' => ['attendee']],
            'p1' => ['@type' => 'Participant', 'email' => 'guest@outside.test', 'name' => 'Guest', 'roles' => ['attendee']],
        ]])->assertOk();
        $assigned = $this->asUser('bob')->getJson('/api/v1/tasks/items/'.$taskId)->assertOk()->json();

        // bob's inbox is not shared with alice, and an outside address has no access anywhere.
        $moved = $this->asUser('bob')->putJson('/api/v1/tasks/items/'.$taskId, [
            'taskListIds' => [InboxTaskListProvisioner::URI => true],
            'title' => 'Moved',
            'participants' => $assigned['participants'],
        ], $this->withIfMatch((string) $assigned['etag']))
            ->assertOk()
            ->assertJsonPath('taskListId', InboxTaskListProvisioner::URI)
            ->json();

        $this->assertSame(['u:bob'], array_keys($moved['participants']));
        $ics = $this->storedIcs($taskId);
        $this->assertStringNotContainsString('alice', $ics);
        $this->assertStringNotContainsString('guest@outside.test', $ics);
    }

    public function test_move_within_the_same_list_keeps_every_assignee(): void
    {
        $taskId = $this->createTask();
        $this->patchTask($taskId, ['participants' => [
            'p1' => ['@type' => 'Participant', 'email' => 'guest@outside.test', 'roles' => ['attendee']],
        ]])->assertOk();

        $participants = $this->patchTask($taskId, ['title' => 'Renamed'])->assertOk()->json('participants');
        $this->assertSame(['e:guest@outside.test'], array_keys($participants));
    }

    public function test_a_person_sharee_cannot_assign_a_team_member_they_share_no_team_with(): void
    {
        // erin can edit the list; she shares Team "side" with bob only, none with alice.
        $this->seedWgwUser('erin', displayName: 'Erin', email: 'erin@example.test');
        $this->seedSharedTeam('side', 'bob', 'erin');
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['shareWith' => [
            'alice' => ['mayWriteAll' => true],
            'carol' => ['mayWriteAll' => false],
            'erin' => ['mayWriteAll' => true],
        ]])->assertOk();
        $taskId = $this->createTask();
        $url = '/api/v1/tasks/items/'.$taskId;
        $patch = function (array $participants) use ($url): TestResponse {
            $etag = (string) $this->asUser('erin')->getJson($url)->assertOk()->json('etag');

            return $this->asUser('erin')->patchJson($url, ['participants' => $participants], $this->withIfMatch($etag));
        };

        $refused = $patch(['u:alice' => ['@type' => 'Participant', 'roles' => ['attendee']]])
            ->assertStatus(422)
            ->assertJsonPath('error', 'Only people who can edit this task list can be assigned.');
        $this->assertStringNotContainsString('alice', strtolower((string) $refused->getContent()));
        $this->assertStringNotContainsString('Alice', (string) $refused->getContent());

        // The owner and erin herself can be assigned.
        $patch([
            'u:bob' => ['@type' => 'Participant', 'roles' => ['attendee']],
            'u:erin' => ['@type' => 'Participant', 'roles' => ['attendee']],
        ])->assertOk()
            ->assertJsonPath('participants.u:bob.username', 'bob')
            ->assertJsonPath('participants.u:erin.username', 'erin');
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
