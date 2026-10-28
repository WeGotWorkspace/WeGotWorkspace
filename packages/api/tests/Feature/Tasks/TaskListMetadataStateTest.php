<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\Principal;
use Tests\Support\CollectionMetadataStateAssertions;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Renaming or recolouring a task list moves the TaskList state of everyone
 * who can see it, from the app and from a DAV client alike (#1671).
 */
final class TaskListMetadataStateTest extends WgwDatabaseTestCase
{
    use CollectionMetadataStateAssertions;
    use TasksTestFixtures;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedInboxTaskListFor('alice');
        $this->setUpDavServer();
        $team = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Team');
        foreach (['bob', 'alice'] as $username) {
            $member = Principal::forUsername($username);
            $this->assertNotNull($member);
            $this->addPrincipalToGroup($team, $member);
        }
    }

    public function test_rename_and_recolour_in_the_app_moves_state_for_owner_and_sharee(): void
    {
        [$ownerId, $shareeId] = $this->sharedList('Errands');
        $before = $this->states();

        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$ownerId, ['name' => 'Errands 2027', 'color' => '#ff0000'])
            ->assertOk()
            ->assertJsonPath('name', 'Errands 2027')
            ->assertJsonPath('color', '#ff0000');

        $this->assertCollectionUpdated($this->changes('bob', $before['bob']), $before['bob'], $ownerId, 'bob');
        $this->assertCollectionUpdated($this->changes('alice', $before['alice']), $before['alice'], $shareeId, 'alice');
    }

    public function test_dav_proppatch_rename_and_recolour_moves_state_for_owner_and_sharee(): void
    {
        [$ownerId, $shareeId] = $this->sharedList('Chores');
        $before = $this->states();

        $this->davProppatch('bob', '/calendars/bob/'.$ownerId, [
            '{DAV:}displayname' => 'Chores 2027',
            self::APPLE_CALENDAR_COLOR => '#00ff00',
        ]);

        $this->assertCollectionUpdated($this->changes('bob', $before['bob']), $before['bob'], $ownerId, 'bob');
        $this->assertCollectionUpdated($this->changes('alice', $before['alice']), $before['alice'], $shareeId, 'alice');

        $owned = $this->asUser('bob')->getJson('/api/v1/tasks/tasklists/'.$ownerId)->assertOk();
        $this->assertSame('Chores 2027', $owned->json('name'));
        $this->assertSame('#00ff00', $owned->json('color'));
    }

    public function test_group_list_rename_reaches_every_member(): void
    {
        $id = (string) $this->asUser('bob')
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Team backlog', 'groupSlug' => self::TEAM])
            ->assertCreated()
            ->json('id');
        $this->assertSame($id, $this->listNamed('alice', 'Team backlog')['id']);
        $before = $this->states();

        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$id, ['name' => 'Team sprint', 'color' => '#123456'])
            ->assertOk();

        $this->assertCollectionUpdated($this->changes('alice', $before['alice']), $before['alice'], $id, 'alice');
        $seen = $this->listNamed('alice', 'Team sprint');
        $this->assertSame($id, $seen['id']);
        $this->assertSame('#123456', $seen['color']);
    }

    /**
     * @return array{0: string, 1: string} the owner's and the sharee's list id
     */
    private function sharedList(string $name): array
    {
        $ownerId = (string) $this->asUser('bob')
            ->postJson('/api/v1/tasks/tasklists', ['name' => $name])
            ->assertCreated()
            ->json('id');
        $this->asUser('bob')
            ->patchJson('/api/v1/tasks/tasklists/'.$ownerId, ['shareWith' => ['alice' => ['mayWriteAll' => true]]])
            ->assertOk();

        return [$ownerId, (string) $this->listNamed('alice', $name)['id']];
    }

    /** @return array{bob: string, alice: string} */
    private function states(): array
    {
        return [
            'bob' => (string) $this->changes('bob', null)['newState'],
            'alice' => (string) $this->changes('alice', null)['newState'],
        ];
    }

    /** @return array<string, mixed> */
    private function changes(string $username, ?string $since): array
    {
        $query = $since === null ? '' : '?since='.rawurlencode($since);

        return $this->asUser($username)->getJson('/api/v1/tasks/tasklists/changes'.$query)->assertOk()->json();
    }

    /** @return array<string, mixed> */
    private function listNamed(string $username, string $name): array
    {
        $row = collect($this->asUser($username)->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list'))
            ->first(static fn (array $list): bool => ($list['name'] ?? '') === $name);
        $this->assertIsArray($row, $username.' must see task list '.$name);

        return $row;
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
