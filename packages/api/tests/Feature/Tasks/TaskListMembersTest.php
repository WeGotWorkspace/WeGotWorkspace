<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Models\User;
use App\Services\Calendars\CalendarCollectionUris;
use Illuminate\Testing\TestResponse;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The list audience behind the assignee picker (#2172):
 * GET /api/v1/tasks/tasklists/{id}/members.
 *
 * Teams: crew = bob, alice, carol; side = bob, erin. dave is in no Team.
 */
final class TaskListMembersTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedWgwUser('dave', displayName: 'Dave');
        $this->seedWgwUser('erin', displayName: 'Erin');
        foreach (['alice', 'dave', 'erin'] as $username) {
            $this->seedInboxTaskListFor($username);
        }
        $this->seedSharedTeam('crew', 'bob', 'alice', 'carol');
        $this->seedSharedTeam('side', 'bob', 'erin');
    }

    public function test_personal_list_lists_owner_writers_and_readers(): void
    {
        $listId = $this->groceriesSharedWithAliceAndCarol();

        $this->assertSame(
            ['alice' => 'write', 'bob' => 'write', 'carol' => 'read'],
            $this->accessByUsername($this->members('bob', $listId)->assertOk()),
        );
        $this->members('bob', $listId)
            ->assertJsonPath('list.0.displayName', 'Alice')
            ->assertJsonPath('list.0.email', 'alice@example.test');
    }

    public function test_a_writer_sharee_gets_the_same_people(): void
    {
        $listId = $this->groceriesSharedWithAliceAndCarol();
        $aliceListId = (string) $this->listNamed('alice', 'Groceries')['id'];

        $this->assertSame(
            ['alice' => 'write', 'bob' => 'write', 'carol' => 'read'],
            $this->accessByUsername($this->members('alice', $aliceListId)->assertOk()),
        );
        $this->assertNotSame('', $listId);
    }

    public function test_read_only_caller_is_forbidden(): void
    {
        $this->groceriesSharedWithAliceAndCarol();
        $carolListId = (string) $this->listNamed('carol', 'Groceries')['id'];

        $this->members('carol', $carolListId)->assertForbidden()->assertJsonPath('code', 'forbidden');
    }

    public function test_members_of_unknown_or_hidden_list_is_404(): void
    {
        $listId = $this->groceriesSharedWithAliceAndCarol();

        $this->members('dave', $listId)->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->members('bob', 'no-such-list')->assertNotFound();
        $this->members('dave', CalendarCollectionUris::groupTaskListApiId('crew'))->assertNotFound();
    }

    public function test_team_list_lists_every_member_as_writer(): void
    {
        $this->assertSame(
            ['alice' => 'write', 'bob' => 'write', 'carol' => 'write'],
            $this->accessByUsername($this->members('bob', CalendarCollectionUris::groupTaskListApiId('crew'))->assertOk()),
        );
    }

    public function test_team_grant_is_expanded_to_its_members(): void
    {
        $listId = $this->createList('bob', 'Errands');
        $this->share('bob', $listId, ['groups/side' => ['mayWriteAll' => true]]);

        $this->assertSame(
            ['bob' => 'write', 'erin' => 'write'],
            $this->accessByUsername($this->members('bob', $listId)->assertOk()),
        );
    }

    public function test_highest_access_wins_when_a_person_comes_twice(): void
    {
        $listId = $this->createList('bob', 'Errands');
        $this->share('bob', $listId, [
            'erin' => ['mayWriteAll' => false],
            'groups/side' => ['mayWriteAll' => true],
        ]);

        $this->assertSame('write', $this->accessByUsername($this->members('bob', $listId))['erin'] ?? null);
    }

    public function test_hidden_grant_is_left_out(): void
    {
        $listId = $this->createList('bob', 'Errands');
        $this->share('bob', $listId, ['erin' => ['mayWriteAll' => true]]);
        $this->removeFromTeam('side', 'erin');

        $this->assertArrayNotHasKey('erin', $this->accessByUsername($this->members('bob', $listId)->assertOk()));
    }

    public function test_disabled_account_is_left_out(): void
    {
        $listId = $this->groceriesSharedWithAliceAndCarol();
        User::query()->where('username', 'carol')->update(['enabled' => false]);

        $this->assertArrayNotHasKey('carol', $this->accessByUsername($this->members('bob', $listId)->assertOk()));
    }

    public function test_person_sharee_only_sees_people_they_share_a_team_with(): void
    {
        $crewList = CalendarCollectionUris::groupTaskListApiId('crew');
        $this->members('bob', $crewList)->assertOk();
        $this->share('bob', $crewList, ['erin' => ['mayWriteAll' => true]]);
        $erinListId = (string) $this->listNamed('erin', 'Crew')['id'];

        // erin shares Team "side" with bob only; alice and carol stay hidden from her.
        $this->assertSame(
            ['bob' => 'write', 'erin' => 'write'],
            $this->accessByUsername($this->members('erin', $erinListId)->assertOk()),
        );
    }

    private function groceriesSharedWithAliceAndCarol(): string
    {
        $listId = $this->createList('bob', 'Groceries');
        $this->share('bob', $listId, [
            'alice' => ['mayWriteAll' => true],
            'carol' => ['mayWriteAll' => false],
        ]);

        return $listId;
    }

    /**
     * @return array<string, string>
     */
    private function accessByUsername(TestResponse $response): array
    {
        $access = [];
        foreach ((array) $response->json('list') as $member) {
            $access[(string) $member['username']] = (string) $member['access'];
        }
        ksort($access);

        return $access;
    }

    private function members(string $username, string $listId): TestResponse
    {
        return $this->asUser($username)->getJson('/api/v1/tasks/tasklists/'.$listId.'/members');
    }

    private function createList(string $username, string $name): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/tasks/tasklists', ['name' => $name])
            ->assertCreated()
            ->json('id');
    }

    /**
     * @param  array<string, array<string, bool>>  $shareWith
     */
    private function share(string $owner, string $listId, array $shareWith): void
    {
        $this->asUser($owner)
            ->patchJson('/api/v1/tasks/tasklists/'.$listId, ['shareWith' => $shareWith])
            ->assertOk();
    }

    private function removeFromTeam(string $slug, string $username): void
    {
        $team = Principal::query()->where('uri', 'principals/groups/'.$slug)->firstOrFail();
        $member = Principal::forUsername($username);
        $this->assertNotNull($member);
        GroupMember::query()->where('principal_id', $team->id)->where('member_id', $member->id)->delete();
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

    private function asUser(string $username): static
    {
        return $this->withBearer($username === 'bob' ? $this->userBearerToken() : $this->issueBearerTokenFor($username));
    }
}
