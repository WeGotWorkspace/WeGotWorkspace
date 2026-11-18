<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Tasks\Threads\TaskThreadSubject;
use Illuminate\Testing\TestResponse;
use Tests\Support\TasksTestFixtures as BaseTaskFixtures;
use Tests\Support\Threads\TaskThreadFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Findings of the #2173 security review: followers stay inside the list's
 * audience, mention names come from the server, reactions are emoji with a
 * cap, and losing access hides the thread everywhere, `/changes` included.
 * bob owns "Groceries", alice writes, carol reads, dave sees nothing.
 */
final class TaskThreadSecurityTest extends WgwDatabaseTestCase
{
    use TaskThreadFixtures;

    private string $listId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTaskThreads();
        $this->listId = $this->groceries();
    }

    public function test_followers_leave_out_a_caldav_attendee_who_cannot_read_the_list(): void
    {
        $taskId = $this->putTaskWithAttendees('bob', $this->listUriOf('bob', 'Groceries'), ['alice', 'dave']);

        $this->assertSame(['alice'], $this->followersAs('bob', $taskId));
    }

    public function test_followers_and_thread_routes_drop_someone_removed_from_the_team(): void
    {
        $listId = $this->createList('bob', 'Crew jobs');
        $taskId = $this->putTaskWithAttendees('bob', $this->listUriOf('bob', 'Crew jobs'), ['alice', 'carol']);
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$listId, ['groupSlug' => 'crew'])->assertOk();
        $entryId = (string) $this->comment('alice', $taskId, 'For the crew')->assertCreated()->json('id');
        $this->assertSame(['alice', 'carol'], $this->followersAs('bob', $taskId));
        $state = (string) $this->asUser('carol')->getJson($this->threadUrl($taskId, 'changes'))->assertOk()->json('newState');

        $this->leaveTeam('carol', 'crew');

        $this->assertSame(['alice'], $this->followersAs('bob', $taskId));
        $this->assertEveryThreadRouteIs404('carol', $taskId, $entryId);
        $this->asUser('carol')->getJson($this->threadUrl($taskId, 'changes').'?since='.$state)
            ->assertNotFound()
            ->assertDontSee($entryId);
    }

    public function test_thread_routes_are_404_after_hiding_the_share(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $entryId = (string) $this->comment('bob', $taskId, 'Shared')->assertCreated()->json('id');

        $this->asUser('alice')->patchJson('/api/v1/tasks/tasklists/'.$this->listIdFor('alice', 'Groceries'), ['isSubscribed' => false])->assertOk();

        $this->assertEveryThreadRouteIs404('alice', $taskId, $entryId);
        $this->assertSame(['Shared'], array_column($this->entries('bob', $taskId), 'body'));
    }

    public function test_changes_with_an_old_state_is_404_after_the_share_is_revoked(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $state = (string) $this->asUser('alice')->getJson($this->threadUrl($taskId, 'changes'))->assertOk()->json('newState');
        $later = (string) $this->comment('bob', $taskId, 'After alice left')->json('id');

        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['shareWith' => ['alice' => null]])->assertOk();

        $this->asUser('alice')->getJson($this->threadUrl($taskId, 'changes').'?since='.$state)
            ->assertNotFound()
            ->assertDontSee($later)
            ->assertDontSee('After alice left');
    }

    public function test_a_spoofed_mention_name_is_replaced_by_the_real_one(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');

        $this->comment('bob', $taskId, '@Alice (Admin)', ['mentions' => [['id' => 'ALICE', 'displayName' => 'Alice (Admin)']]])
            ->assertCreated()
            ->assertJsonPath('mentions', [['id' => 'alice', 'displayName' => 'Alice']]);
        $this->assertSame([['id' => 'alice', 'displayName' => 'Alice']], $this->entries('carol', $taskId)[0]['mentions']);
    }

    public function test_reactions_must_be_emoji_and_are_capped_per_entry(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $entryId = (string) $this->comment('bob', $taskId, 'React')->assertCreated()->json('id');
        $url = $this->threadUrl($taskId, 'entries/'.$entryId.'/reactions');

        $this->asUser('alice')->postJson($url, ['emoji' => 'lol'])->assertStatus(422)->assertJsonPath('code', 'invalid_emoji');
        foreach (['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊', '😋', '😎', '😍', '😘', '🥰', '😗', '😙', '🥲', '😚', '🙂'] as $emoji) {
            $this->asUser('alice')->postJson($url, ['emoji' => $emoji])->assertOk();
        }
        $this->asUser('bob')->postJson($url, ['emoji' => '🤗'])->assertStatus(422)->assertJsonPath('code', 'too_many_reactions');
        $this->asUser('bob')->postJson($url, ['emoji' => '😀'])->assertOk();
    }

    public function test_the_team_owned_pool_is_invisible_over_dav(): void
    {
        $taskId = $this->createTask('bob', $this->listId, 'Milk');
        $entryId = (string) $this->comment('bob', $taskId, 'Team pool')->assertCreated()->json('id');
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['groupSlug' => 'crew'])->assertOk();
        $this->assertSame(['Team pool'], array_column($this->entries('alice', $taskId), 'body'));

        $home = $this->davAt('alice', 'PROPFIND', '/calendars/groups/crew/', ['HTTP_DEPTH' => '1']);
        $this->assertNotSame(500, $home->getStatusCode());
        $this->assertStringNotContainsString('task-threads', (string) $home->getContent());
        $this->assertContains($this->davAt('alice', 'PROPFIND', '/calendars/groups/crew/task-threads/', ['HTTP_DEPTH' => '1'])->getStatusCode(), [403, 404]);
        $this->assertContains($this->davAt('alice', 'GET', '/calendars/groups/crew/task-threads/'.$entryId.'.ics')->getStatusCode(), [403, 404]);
    }

    /**
     * @param  list<string>  $attendees
     */
    private function putTaskWithAttendees(string $owner, string $listUri, array $attendees): string
    {
        $lines = '';
        foreach ($attendees as $username) {
            $lines .= "ATTENDEE;CN={$username}:mailto:{$username}@example.test\r\n";
        }
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VTODO\r\nUID:jobs-1\r\nDTSTAMP:20261118T120000Z\r\nSUMMARY:Jobs\r\n{$lines}END:VTODO\r\nEND:VCALENDAR\r\n";
        $this->dav($owner, 'PUT', $listUri.'/jobs.ics', $ics)->assertCreated();

        return BaseTaskFixtures::taskIdFromObjectUri('jobs.ics', $ics);
    }

    /** @return list<string> */
    private function followersAs(string $username, string $taskId): array
    {
        $type = app(TaskThreadSubject::class);
        $subject = $type->resolve($username, $taskId);
        $this->assertNotNull($subject);
        $followers = $type->followers($subject);
        sort($followers);

        return $followers;
    }

    private function leaveTeam(string $username, string $slug): void
    {
        $team = Principal::query()->where('uri', 'principals/groups/'.$slug)->firstOrFail();
        $member = Principal::forUsername($username);
        $this->assertNotNull($member);
        GroupMember::query()->where('principal_id', $team->id)->where('member_id', $member->id)->delete();
    }

    private function assertEveryThreadRouteIs404(string $username, string $taskId, string $entryId): void
    {
        $as = $this->asUser($username);
        $as->getJson($this->threadUrl($taskId, 'entries'))->assertNotFound();
        $as->getJson($this->threadUrl($taskId, 'changes'))->assertNotFound();
        $as->postJson($this->threadUrl($taskId, 'entries'), ['id' => $this->ulid(), 'body' => 'x'])->assertNotFound();
        $as->patchJson($this->threadUrl($taskId, 'entries/'.$entryId), ['body' => 'x'])->assertNotFound();
        $as->deleteJson($this->threadUrl($taskId, 'entries/'.$entryId))->assertNotFound();
        $as->postJson($this->threadUrl($taskId, 'entries/'.$entryId.'/reactions'), ['emoji' => '👍'])->assertNotFound();
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function davAt(string $username, string $method, string $path, array $headers = []): TestResponse
    {
        return $this->call($method, $path, [], [], [], [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':secret'),
            ...$headers,
        ]);
    }
}
